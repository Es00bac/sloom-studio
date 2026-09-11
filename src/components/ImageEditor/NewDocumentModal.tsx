import { useState } from 'react';
import { X } from 'lucide-react';
import { showAlertDialog } from '../../store/alertDialogStore';
import { AdvancedColorPicker } from '../Common/AdvancedColorPicker';

export interface NewDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (options: {
    title: string;
    width: number;
    height: number;
    background: string;
  }) => void;
}

const PRESETS = [
  { label: 'Custom Canvas...', width: 800, height: 600 },
  { label: 'Web Comic Page (800 x 1200)', width: 800, height: 1200 },
  { label: 'HD Screen 1080p (1920 x 1080)', width: 1920, height: 1080 },
  { label: '4K Ultra HD (3840 x 2160)', width: 3840, height: 2160 },
  { label: 'Square Instagram (1080 x 1080)', width: 1080, height: 1080 },
  { label: 'Print Letter US 300 DPI (2550 x 3300)', width: 2550, height: 3300 },
  { label: 'Print A4 300 DPI (2480 x 3508)', width: 2480, height: 3508 },
];

export function NewDocumentModal({ isOpen, onClose, onCreate }: NewDocumentModalProps) {
  const [title, setTitle] = useState('Untitled-1');
  const [selectedPresetIndex, setSelectedPresetIndex] = useState(0);
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(600);
  const [bgType, setBgType] = useState<'transparent' | 'white' | 'black' | 'custom'>('white');
  const [customBgColor, setCustomBgColor] = useState('#cccccc');

  if (!isOpen) return null;

  const handlePresetChange = (index: number) => {
    setSelectedPresetIndex(index);
    const preset = PRESETS[index];
    if (preset) {
      setWidth(preset.width);
      setHeight(preset.height);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (width <= 0 || height <= 0) {
      void showAlertDialog({
        title: 'Invalid Canvas Size',
        message: 'Width and Height must be positive integers.',
        tone: 'warning',
      });
      return;
    }

    let background = 'transparent';
    if (bgType === 'white') background = '#ffffff';
    else if (bgType === 'black') background = '#000000';
    else if (bgType === 'custom') background = customBgColor;

    onCreate({
      title: title.trim() || 'Untitled',
      width: Math.floor(width),
      height: Math.floor(height),
      background,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-md border border-cyan-300/15 bg-[#171821] p-6 shadow-2xl rounded-sm text-cyan-100">
        <div className="flex items-center justify-between border-b border-cyan-300/10 pb-3 mb-4">
          <h3 className="text-sm font-semibold tracking-wide text-cyan-200">Create New Canvas</h3>
          <button
            className="text-cyan-100/40 hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-cyan-100/60 mb-1">Document Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-cyan-300/10 bg-[#0e0f15] px-3 py-1.5 text-xs text-cyan-100 focus:border-cyan-400 focus:outline-none rounded-sm"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-cyan-100/60 mb-1">Document Preset</label>
            <select
              value={selectedPresetIndex}
              onChange={(e) => handlePresetChange(Number(e.target.value))}
              className="w-full border border-cyan-300/10 bg-[#0e0f15] px-3 py-1.5 text-xs text-cyan-100 focus:border-cyan-400 focus:outline-none rounded-sm"
            >
              {PRESETS.map((preset, idx) => (
                <option key={idx} value={idx}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-cyan-100/60 mb-1">Width (pixels)</label>
              <input
                type="number"
                min="1"
                max="10000"
                value={width}
                onChange={(e) => {
                  setWidth(Number(e.target.value));
                  setSelectedPresetIndex(0); // Set preset to Custom
                }}
                className="w-full border border-cyan-300/10 bg-[#0e0f15] px-3 py-1.5 text-xs text-cyan-100 focus:border-cyan-400 focus:outline-none rounded-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-cyan-100/60 mb-1">Height (pixels)</label>
              <input
                type="number"
                min="1"
                max="10000"
                value={height}
                onChange={(e) => {
                  setHeight(Number(e.target.value));
                  setSelectedPresetIndex(0); // Set preset to Custom
                }}
                className="w-full border border-cyan-300/10 bg-[#0e0f15] px-3 py-1.5 text-xs text-cyan-100 focus:border-cyan-400 focus:outline-none rounded-sm"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-cyan-100/60 mb-1">Canvas Background</label>
            <div className="grid grid-cols-4 gap-2">
              {(['white', 'black', 'transparent', 'custom'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setBgType(type)}
                  className={`border px-2 py-1.5 text-[11px] capitalize focus:outline-none rounded-sm ${
                    bgType === type
                      ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200'
                      : 'border-cyan-300/10 bg-[#0e0f15]/50 text-cyan-100/70 hover:bg-[#0e0f15]'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            {bgType === 'custom' && (
              <div className="flex items-center gap-2 mt-2">
                <AdvancedColorPicker
                  value={customBgColor}
                  onChange={setCustomBgColor}
                  label="Custom canvas background"
                  className="h-8 w-10"
                  buttonClassName="border border-cyan-300/10 bg-transparent focus:outline-none rounded-xs"
                />
                <input
                  type="text"
                  value={customBgColor}
                  onChange={(e) => setCustomBgColor(e.target.value)}
                  className="border border-cyan-300/10 bg-[#0e0f15] px-3 py-1 text-xs text-cyan-100 focus:border-cyan-400 focus:outline-none rounded-sm"
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-cyan-300/10 pt-4 mt-6">
            <button
              onClick={onClose}
              type="button"
              className="px-4 py-1.5 text-xs border border-cyan-300/10 text-cyan-100/70 hover:bg-cyan-100/5 hover:text-white rounded-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-1.5 text-xs bg-cyan-500/80 hover:bg-cyan-500 text-white font-medium rounded-sm"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
