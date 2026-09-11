import type { ResultType } from '../../types/flow';

const TYPE_LABELS: Record<ResultType, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Boolean',
  json: 'JSON',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  package: 'Package',
  list: 'List',
  envelope: 'Envelope',
};

export function DeclaredOutputTypeSelect({
  allowedTypes,
  onChange,
  value,
}: {
  allowedTypes: readonly ResultType[];
  onChange: (value: ResultType | undefined) => void;
  value?: ResultType;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-semibold text-gray-200">Output type:</span>
      <select
        aria-label="Output type"
        className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-[11px] text-gray-100 focus:border-cyan-400 focus:outline-none"
        onChange={(event) => onChange(event.target.value ? event.target.value as ResultType : undefined)}
        value={value ?? ''}
      >
        <option value="">Unspecified — typed output blocked</option>
        {allowedTypes.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
      </select>
      {!value ? (
        <span className="leading-4 text-amber-300/80">
          Choose the type this node promises to return before connecting its output.
        </span>
      ) : null}
    </label>
  );
}
