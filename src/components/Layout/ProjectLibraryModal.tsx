import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FolderOpen, Save, Trash2, Upload, X } from 'lucide-react';
import { useFlowStore } from '../../store/flowStore';
import { useConfirmationStore } from '../../store/confirmationStore';
import { useSourceBinStore } from '../../store/sourceBinStore';
import {
  deleteProjectDocument,
  downloadJsonFile,
  type FlowProjectDocument,
  listProjectSummaries,
  loadProjectDocument,
  parseProjectDocument,
  saveProjectDocument,
  isRemoteLanClient,
  type FlowProjectSummary,
} from '../../lib/projectLibrary';
import { exportProjectAssets } from '../../lib/projectAssets';
import { formatProjectBytes } from '../../lib/projectSizeReport';
import {
  assertSavedProjectPaperAssetsPortable,
  buildCurrentProjectDocument as buildFullProjectDocument,
  buildDirtyImageReplacementConfirmationMessage,
  replaceProjectDocument,
  replaceWithBlankProject,
  type DirtyImageReplacementAuthorization,
} from '../../lib/projectDocumentActions';
import { acknowledgePaperProjectSnapshot } from '../../lib/paperLossPrevention';
import {
  DEFAULT_SCRATCH_DIRECTORY_NAME,
  PROJECT_DOCUMENT_FILE_NAME,
  isFileSystemAccessSupported,
  loadFileSystemWorkspaceHandles,
  loadFileSystemWorkspaceSummary,
  loadProjectDocumentFromDirectory,
  pickDirectory,
  saveFileSystemWorkspaceHandles,
  saveProjectWorkspaceToFileSystem,
  writeScratchAssets,
  type FileSystemWorkspaceSummary,
} from '../../lib/fileSystemWorkspace';
import { APP_NAME, DEFAULT_PROJECT_NAME, UNTITLED_PROJECT_NAME } from '../../lib/brand';
import { DockableDialog } from '../DockablePanel';

interface ProjectLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProjectLibraryModal({ isOpen, onClose }: ProjectLibraryModalProps) {
  const nodes = useFlowStore((state) => state.nodes);
  const exportProjectSourceBin = useSourceBinStore((state) => state.exportProjectSnapshot);
  const setSourceBinScratchDirectoryHandle = useSourceBinStore((state) => state.setScratchDirectoryHandle);
  const migrateSourceBinAssetsToScratch = useSourceBinStore((state) => state.migrateAssetsToScratch);
  const [projectName, setProjectName] = useState('');
  const [projects, setProjects] = useState<FlowProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const [statusMessage, setStatusMessage] = useState<string | undefined>();
  const [isBusy, setIsBusy] = useState(false);
  const [fileSystemSummary, setFileSystemSummary] = useState<FileSystemWorkspaceSummary | undefined>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileSystemSupported = isFileSystemAccessSupported();

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId],
  );
  const activeFileSystemSummary = selectedProjectId ? fileSystemSummary : undefined;

  const refreshProjects = useCallback(async () => {
    const nextProjects = await listProjectSummaries();
    setProjects(nextProjects);

    if (!selectedProjectId || !nextProjects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(nextProjects[0]?.id);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void refreshProjects();
    }, 0);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isOpen, refreshProjects]);

  useEffect(() => {
    if (!isOpen || !selectedProjectId) {
      return;
    }

    let cancelled = false;

    void loadFileSystemWorkspaceSummary(selectedProjectId).then((summary) => {
      if (!cancelled) {
        setFileSystemSummary(summary);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedProjectId]);

  async function buildCurrentProjectDocument(projectId?: string): Promise<FlowProjectDocument> {
    // Always serialize through the canonical full-project builder: a local partial document
    // would overwrite the stored record and silently discard Paper, Image, usage-ledger, and
    // any future project slice. The modal only contributes name/id resolution and its
    // linked-folder metadata on top.
    const document = await buildFullProjectDocument({
      id: projectId ?? selectedProjectId,
      name: projectName.trim() || selectedProject?.name,
    });

    return activeFileSystemSummary
      ? {
        ...document,
        fileSystem: {
          projectDirectoryName: activeFileSystemSummary.projectDirectoryName,
          scratchDirectoryName: activeFileSystemSummary.scratchDirectoryName,
        },
      }
      : document;
  }

  async function persistCurrentProject(projectId?: string): Promise<FlowProjectDocument> {
    const document = await buildCurrentProjectDocument(projectId);
    const saved = await saveProjectDocument(document);

    if (!isRemoteLanClient()) acknowledgePaperProjectSnapshot(saved.paper ?? document.paper);

    setProjectName(saved.name);
    setSelectedProjectId(saved.id);
    await refreshProjects();
    return saved;
  }

  async function saveCurrentProjectBeforeReplacement() {
    try {
      // The selected library row may be the project the owner is about to open. Save the current
      // workspace as a new durable record so the guard can never overwrite that target by accident.
      if (isRemoteLanClient()) {
        return {
          status: 'unacknowledged' as const,
          error: 'This served collaboration session is read-only and cannot acknowledge a durable project save.',
        };
      }
      const document = await buildFullProjectDocument({
        name: projectName.trim() || `${DEFAULT_PROJECT_NAME} recovery`,
      });
      const saved = await saveProjectDocument(document);
      if (!acknowledgePaperProjectSnapshot(saved.paper ?? document.paper)) {
        return {
          status: 'failed' as const,
          error: 'Paper changed while the project was being saved. The newer changes remain open; save again before replacing the project.',
        };
      }
      setProjectName(saved.name);
      await refreshProjects();
      return { status: 'success' as const };
    } catch (error) {
      return {
        status: 'failed' as const,
        error: error instanceof Error ? error.message : 'The current project could not be saved.',
      };
    }
  }

  const authorizeDirtyImageReplacement: DirtyImageReplacementAuthorization = async (projection) => (
    useConfirmationStore.getState().requestConfirmation(
      buildDirtyImageReplacementConfirmationMessage(projection),
      'Discard Image Changes?',
    )
  );

  async function handleCreateBlankProject() {
    const replaced = await replaceWithBlankProject({
      key: 'library:new-project',
      save: saveCurrentProjectBeforeReplacement,
      confirmOtherChanges: () => useConfirmationStore.getState().requestConfirmation(
        'Start a new blank project? Any unsaved changes in the current workspace will be discarded.',
        'Start New Project',
      ),
    });
    if (!replaced) return;
    setProjectName(UNTITLED_PROJECT_NAME);
    setSelectedProjectId(undefined);
    setFileSystemSummary(undefined);
    setStatusMessage(`Started a new blank ${APP_NAME} project.`);
    onClose();
  }

  async function handleSaveProject(projectId?: string) {
    setIsBusy(true);
    setStatusMessage(undefined);

    try {
      const saved = await persistCurrentProject(projectId);

      setStatusMessage(`Saved ${saved.name}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to save the project.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleOpenProject(projectId: string) {
    setIsBusy(true);
    setStatusMessage(undefined);

    try {
      const project = await loadProjectDocument(projectId);

      if (!project) {
        throw new Error('The selected project could not be found.');
      }

      const replaced = await replaceProjectDocument(project, {
        key: `library:open:${project.id}`,
        save: saveCurrentProjectBeforeReplacement,
        authorizeDirtyImageReplacement,
      });
      if (!replaced) return;
      setProjectName(project.name);
      setSelectedProjectId(project.id);
      setFileSystemSummary(await loadFileSystemWorkspaceSummary(project.id));
      setStatusMessage(`Opened ${project.name}.`);
      onClose();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to open the selected project.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDeleteProject(projectId: string) {
    const confirmed = await useConfirmationStore.getState().requestConfirmation(
      'Delete this saved project from local storage?',
      'Delete Project'
    );
    if (!confirmed) {
      return;
    }

    setIsBusy(true);
    setStatusMessage(undefined);

    try {
      await deleteProjectDocument(projectId);
      setStatusMessage('Deleted the selected local project.');
      await refreshProjects();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to delete the selected project.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleExportProjectJson(projectId?: string) {
    setIsBusy(true);
    setStatusMessage(undefined);

    try {
      // Exporting a hand-picked field subset here silently dropped Paper and every other
      // non-flow slice from the produced .sloom. Export the stored record verbatim, or the
      // current workspace through the canonical full-project builder.
      let project: FlowProjectDocument;

      if (projectId) {
        const stored = await loadProjectDocument(projectId);

        if (!stored) {
          throw new Error('The selected project could not be found.');
        }

        project = stored;
        assertSavedProjectPaperAssetsPortable(project);
      } else {
        project = await buildFullProjectDocument({
          name: projectName.trim() || selectedProject?.name,
          includeAssetData: true,
          // Exported .sloom copies promise self-containment; Paper asset policy failures surface
          // here as the status message instead of producing a file that lies about completeness.
          strictPaperAssets: true,
        });
      }

      downloadJsonFile(`${slugify(project.name)}.sloom`, project);

      setStatusMessage(`Exported ${project.name} as a Sloom Studio project file.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to export the project.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleImportProjectFile(file: File) {
    setIsBusy(true);
    setStatusMessage(undefined);

    try {
      const project = await parseProjectDocument(file);
      const replaced = await replaceProjectDocument(project, {
        key: `library:import:${project.id}`,
        save: saveCurrentProjectBeforeReplacement,
        authorizeDirtyImageReplacement,
      });
      if (!replaced) return;
      setProjectName(project.name);
      setSelectedProjectId(project.id);
      await saveProjectDocument(project);
      await refreshProjects();
      setStatusMessage(`Imported ${project.name}.`);
      onClose();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to import the selected project file.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleExportAssets() {
    setIsBusy(true);
    setStatusMessage(undefined);

    try {
      const assets = await exportProjectAssets(nodes);
      setStatusMessage(
        assets.length > 0
          ? `Exported ${assets.length} asset${assets.length === 1 ? '' : 's'}.`
          : 'No media assets are available to export yet.',
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to export the project assets.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSaveProjectToFolder() {
    setIsBusy(true);
    setStatusMessage(undefined);

    try {
      if (!fileSystemSupported) {
        throw new Error('This browser does not support choosing local project folders. Use Chrome, Edge, or another File System Access capable browser.');
      }

      const initialProject = await persistCurrentProject(selectedProjectId);
      const projectDirectoryHandle = await pickDirectory();
      const existingHandles = await loadFileSystemWorkspaceHandles(initialProject.id);
      const scratchDirectoryHandle =
        existingHandles.scratchDirectoryHandle ??
        await projectDirectoryHandle.getDirectoryHandle(DEFAULT_SCRATCH_DIRECTORY_NAME, { create: true });
      setSourceBinScratchDirectoryHandle(scratchDirectoryHandle);
      const migratedCount = await migrateSourceBinAssetsToScratch(scratchDirectoryHandle);
      const project = await persistCurrentProject(initialProject.id);
      const result = await saveProjectWorkspaceToFileSystem({
        document: project,
        projectDirectoryHandle,
        scratchDirectoryHandle,
      });
      const summary = await saveFileSystemWorkspaceHandles({
        projectId: project.id,
        projectDirectoryHandle,
        scratchDirectoryHandle,
      });

      setFileSystemSummary(summary);
      setStatusMessage(
        `Saved ${project.name} to folder "${result.projectDirectoryName}" and moved ${migratedCount} active asset${migratedCount === 1 ? '' : 's'} into scratch folder "${result.scratchDirectoryName}".`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to save the project to a folder.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSaveToLinkedFolder() {
    setIsBusy(true);
    setStatusMessage(undefined);

    try {
      if (!selectedProjectId) {
        throw new Error('Save or select a project before using a linked project folder.');
      }

      const handles = await loadFileSystemWorkspaceHandles(selectedProjectId);

      if (!handles.projectDirectoryHandle) {
        throw new Error('No project folder is linked yet. Use "Save Project To Folder" first.');
      }

      const scratchDirectoryHandle =
        handles.scratchDirectoryHandle ??
        await handles.projectDirectoryHandle.getDirectoryHandle(DEFAULT_SCRATCH_DIRECTORY_NAME, { create: true });
      setSourceBinScratchDirectoryHandle(scratchDirectoryHandle);
      const migratedCount = await migrateSourceBinAssetsToScratch(scratchDirectoryHandle);
      const project = await persistCurrentProject(selectedProjectId);
      const result = await saveProjectWorkspaceToFileSystem({
        document: project,
        projectDirectoryHandle: handles.projectDirectoryHandle,
        scratchDirectoryHandle,
      });
      const summary = await saveFileSystemWorkspaceHandles({
        projectId: project.id,
        projectDirectoryHandle: handles.projectDirectoryHandle,
        scratchDirectoryHandle,
      });

      setFileSystemSummary(summary);
      setStatusMessage(
        `Updated "${result.projectDirectoryName}/${PROJECT_DOCUMENT_FILE_NAME}" and moved ${migratedCount} active asset${migratedCount === 1 ? '' : 's'} into scratch storage.`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to save to the linked project folder.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleOpenProjectFolder() {
    setIsBusy(true);
    setStatusMessage(undefined);

    try {
      if (!fileSystemSupported) {
        throw new Error('This browser does not support choosing local project folders. Use Chrome, Edge, or another File System Access capable browser.');
      }

      const projectDirectoryHandle = await pickDirectory();
      const project = await loadProjectDocumentFromDirectory(projectDirectoryHandle);
      const saved = await saveProjectDocument(project);
      const scratchDirectoryHandle = await projectDirectoryHandle.getDirectoryHandle(DEFAULT_SCRATCH_DIRECTORY_NAME, { create: true });
      setSourceBinScratchDirectoryHandle(scratchDirectoryHandle);
      const summary = await saveFileSystemWorkspaceHandles({
        projectId: saved.id,
        projectDirectoryHandle,
        scratchDirectoryHandle,
      });

      const replaced = await replaceProjectDocument(saved, {
        key: `library:open-folder:${saved.id}`,
        save: saveCurrentProjectBeforeReplacement,
        authorizeDirtyImageReplacement,
      });
      if (!replaced) return;
      setProjectName(saved.name);
      setSelectedProjectId(saved.id);
      setFileSystemSummary(summary);
      await refreshProjects();
      setStatusMessage(`Opened ${saved.name} from folder "${projectDirectoryHandle.name}".`);
      onClose();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to open a project folder.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleChooseScratchFolder() {
    setIsBusy(true);
    setStatusMessage(undefined);

    try {
      if (!fileSystemSupported) {
        throw new Error('This browser does not support choosing local scratch folders. Use Chrome, Edge, or another File System Access capable browser.');
      }

      const initialProject = await persistCurrentProject(selectedProjectId);
      const scratchDirectoryHandle = await pickDirectory();
      setSourceBinScratchDirectoryHandle(scratchDirectoryHandle);
      const migratedCount = await migrateSourceBinAssetsToScratch(scratchDirectoryHandle);
      const project = await persistCurrentProject(initialProject.id);
      const assetCount = project.sourceBin ? await writeScratchAssets(scratchDirectoryHandle, project.sourceBin) : 0;
      const summary = await saveFileSystemWorkspaceHandles({
        projectId: project.id,
        scratchDirectoryHandle,
      });

      setFileSystemSummary(summary);
      setStatusMessage(
        `Linked scratch folder "${scratchDirectoryHandle.name}" for ${project.name}, moved ${migratedCount} active asset${migratedCount === 1 ? '' : 's'} out of browser storage, and wrote ${assetCount} source asset${assetCount === 1 ? '' : 's'}.`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to configure the scratch folder.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleExportScratchAssets() {
    setIsBusy(true);
    setStatusMessage(undefined);

    try {
      if (!selectedProjectId) {
        throw new Error('Save or select a project before exporting scratch assets.');
      }

      const handles = await loadFileSystemWorkspaceHandles(selectedProjectId);

      if (!handles.scratchDirectoryHandle) {
        throw new Error('No scratch folder is linked yet. Use "Set Scratch Folder" first.');
      }

      setSourceBinScratchDirectoryHandle(handles.scratchDirectoryHandle);
      await migrateSourceBinAssetsToScratch(handles.scratchDirectoryHandle);
      const sourceBin = await exportProjectSourceBin();
      const assetCount = await writeScratchAssets(handles.scratchDirectoryHandle, sourceBin);

      setStatusMessage(
        `Wrote ${assetCount} source asset${assetCount === 1 ? '' : 's'} to scratch folder "${handles.scratchDirectoryHandle.name}".`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to export scratch assets.');
    } finally {
      setIsBusy(false);
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <DockableDialog
      defaultFloatingRect={{ x: 96, y: 76, width: 1040, height: 680 }}
      dialogId="project-library"
      minSize={{ width: 620, height: 420 }}
      onClose={onClose}
      open={isOpen}
      title="Project Library"
      workspaceId="app-dialogs"
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#1c1e26]">
        <div className="flex items-center justify-between border-b border-gray-800 bg-[#252830] p-5">
          <div>
            <h2 className="text-xl font-semibold text-gray-100">Project Library</h2>
            <p className="mt-1 text-sm text-gray-400">
              Save named local workspaces, reopen them later, and keep each project's source assets bundled with its flow/editor state.
            </p>
          </div>
          <button
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X size={20} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[380px_minmax(0,1fr)] gap-0">
          <aside className="min-h-0 border-r border-gray-800 bg-[#191c24] p-5">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-300">Project Name</label>
                <input
                  className="mt-2 w-full rounded-xl border border-gray-700/60 bg-[#111217]/70 px-3 py-2 text-sm text-gray-100 outline-none"
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder={DEFAULT_PROJECT_NAME}
                  value={projectName}
                />
              </div>

              <div className="grid gap-2">
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-100 transition-colors hover:border-cyan-400/50 hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isBusy}
                  onClick={() => void handleCreateBlankProject()}
                  type="button"
                >
                  <FolderOpen size={14} />
                  New Blank Project
                </button>
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isBusy}
                  onClick={() => void handleSaveProject()}
                  type="button"
                >
                  <Save size={14} />
                  Save Current Project
                </button>
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-700/60 bg-[#111217]/60 px-3 py-2 text-sm font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isBusy || !selectedProject}
                  onClick={() => void handleSaveProject(selectedProject?.id)}
                  type="button"
                >
                  <Save size={14} />
                  Overwrite Selected
                </button>
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-700/60 bg-[#111217]/60 px-3 py-2 text-sm font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isBusy}
                  onClick={() => void handleExportProjectJson()}
                  type="button"
                >
                  <Download size={14} />
                  Export Current Project JSON
                </button>
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-700/60 bg-[#111217]/60 px-3 py-2 text-sm font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isBusy}
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  <Upload size={14} />
                  Import Project JSON
                </button>
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-700/60 bg-[#111217]/60 px-3 py-2 text-sm font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isBusy}
                  onClick={() => void handleExportAssets()}
                  type="button"
                >
                  <FolderOpen size={14} />
                  Export All Media Assets
                </button>
              </div>

              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="text-sm font-semibold text-emerald-100">Filesystem Project Folder</div>
                <div className="mt-1 text-xs leading-5 text-emerald-50/75">
                  Current browser fallback: projects and assets are also kept in IndexedDB. Use these controls to write the project and per-project scratch assets to real local folders.
                </div>
                {!fileSystemSupported ? (
                  <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-100">
                    This browser does not expose folder access to web apps. Use Chrome or Edge for direct project-folder and scratch-folder writes.
                  </div>
                ) : null}
                <div className="mt-3 grid gap-2">
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-100 transition-colors hover:border-emerald-400/50 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isBusy || !fileSystemSupported}
                    onClick={() => void handleSaveProjectToFolder()}
                    type="button"
                  >
                    <FolderOpen size={14} />
                    Save Project To Folder
                  </button>
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-700/60 bg-[#111217]/60 px-3 py-2 text-sm font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isBusy || !fileSystemSupported || !activeFileSystemSummary?.hasProjectDirectory}
                    onClick={() => void handleSaveToLinkedFolder()}
                    type="button"
                  >
                    <Save size={14} />
                    Save To Linked Folder
                  </button>
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-700/60 bg-[#111217]/60 px-3 py-2 text-sm font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isBusy || !fileSystemSupported}
                    onClick={() => void handleOpenProjectFolder()}
                    type="button"
                  >
                    <FolderOpen size={14} />
                    Open Project Folder
                  </button>
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-700/60 bg-[#111217]/60 px-3 py-2 text-sm font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isBusy || !fileSystemSupported}
                    onClick={() => void handleChooseScratchFolder()}
                    type="button"
                  >
                    <FolderOpen size={14} />
                    Set Scratch Folder
                  </button>
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-700/60 bg-[#111217]/60 px-3 py-2 text-sm font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isBusy || !fileSystemSupported || !activeFileSystemSummary?.hasScratchDirectory}
                    onClick={() => void handleExportScratchAssets()}
                    type="button"
                  >
                    <Download size={14} />
                    Export Source Bin To Scratch
                  </button>
                </div>
                <div className="mt-3 rounded-xl border border-gray-700/60 bg-[#0d1118]/70 px-3 py-2 text-xs leading-5 text-gray-300">
                  <div>Project folder: {activeFileSystemSummary?.projectDirectoryName ?? 'Not linked'}</div>
                  <div>Scratch folder: {activeFileSystemSummary?.scratchDirectoryName ?? 'Not linked'}</div>
                </div>
              </div>

              {statusMessage ? (
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-sm text-blue-100">
                  {statusMessage}
                </div>
              ) : null}

              <input
                // `.sloom` has no registered MIME type, so Android's file picker greys the files out
                // when `accept` is just the extension. Add the octet-stream/json types Android maps
                // them to so they stay selectable; the picked file is still validated by content.
                accept=".sloom,application/json,application/octet-stream"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    void handleImportProjectFile(file);
                  }

                  event.currentTarget.value = '';
                }}
                ref={fileInputRef}
                type="file"
              />
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-100">Saved Local Projects</div>
                <div className="mt-1 text-xs text-gray-500">These workspaces are stored on this machine in the browser.</div>
              </div>
              <button
                className="rounded-xl border border-gray-700/60 bg-[#111217]/60 px-3 py-2 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
                onClick={() => void refreshProjects()}
                type="button"
              >
                Refresh
              </button>
            </div>

            <div className="space-y-3">
              {projects.length > 0 ? (
                projects.map((project) => (
                  <div
                    key={project.id}
                    className={`rounded-xl border p-4 ${
                      project.id === selectedProjectId
                        ? 'border-blue-400/40 bg-blue-500/10'
                        : 'border-gray-700/60 bg-[#111217]/35'
                    }`}
                  >
                    <button
                      className="w-full text-left"
                      onClick={() => {
                        setSelectedProjectId(project.id);
                        setProjectName(project.name);
                      }}
                      type="button"
                    >
                      <div className="text-sm font-semibold text-gray-100">{project.name}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {project.nodeCount} nodes · saved {new Date(project.savedAt).toLocaleString()}
                      </div>
                      {project.sizeReport ? (
                        <div className="mt-1 text-xs text-gray-400" data-testid={`project-size-${project.id}`}>
                          {formatProjectBytes(project.sizeReport.documentBytes)} · {project.sizeReport.embeddedMediaCount} embedded media
                          {project.sizeReport.externalReferenceCount > 0
                            ? ` · ${project.sizeReport.externalReferenceCount} Source Library refs`
                            : ''}
                          {project.sizeReport.truncated ? ' · measurement truncated' : ''}
                        </div>
                      ) : null}
                    </button>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="rounded-lg border border-gray-700/60 bg-[#0f131b] px-3 py-1.5 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
                        onClick={() => void handleOpenProject(project.id)}
                        type="button"
                      >
                        Open
                      </button>
                      <button
                        className="rounded-lg border border-gray-700/60 bg-[#0f131b] px-3 py-1.5 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
                        onClick={() => void handleExportProjectJson(project.id)}
                        type="button"
                      >
                        Export
                      </button>
                      <button
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-100 transition-colors hover:border-red-400/60 hover:bg-red-500/15"
                        onClick={() => void handleDeleteProject(project.id)}
                        type="button"
                      >
                        <Trash2 size={12} className="inline mr-1" />
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-gray-700/60 bg-[#111217]/35 p-4 text-sm text-gray-400">
                  No saved projects yet. Save the current workspace to create a reusable local project.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </DockableDialog>
  );
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'signal-loom-project';
}
