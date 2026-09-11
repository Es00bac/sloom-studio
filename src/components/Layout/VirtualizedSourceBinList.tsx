import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface VirtualizedSourceBinListProps<T extends object> {
  items: readonly T[];
  rowHeight: number;
  renderRow: (item: T, index: number) => ReactNode;
  getItemKey?: (item: T, index: number) => string;
  getItemHeight?: (item: T, index: number) => number;
  overscan?: number;
  className?: string;
  initialHeight?: number;
  initialScrollTop?: number;
  rowGap?: number;
}

export function VirtualizedSourceBinList<T extends object>({
  items,
  rowHeight,
  renderRow,
  getItemKey,
  getItemHeight,
  overscan = 1,
  className,
  initialHeight = 0,
  initialScrollTop = 0,
  rowGap = 0,
}: VirtualizedSourceBinListProps<T>) {
  type VisibleRow = { item: T; index: number; height: number; key: string };
  type MeasuredHeights = Record<string, number>;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [viewportHeight, setViewportHeight] = useState(initialHeight);
  const [scrollTop, setScrollTop] = useState(initialScrollTop);
  const [measuredHeights, setMeasuredHeights] = useState<MeasuredHeights>({});

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) {
      return;
    }

    const measure = () => {
      setViewportHeight(node.clientHeight || initialHeight);
    };

    node.scrollTop = initialScrollTop;
    measure();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [initialHeight, initialScrollTop]);

  const itemKeys = useMemo(
    () => items.map((item, index) => getItemKey?.(item, index) ?? (('id' in item && typeof item.id === 'string') ? item.id : `${index}`)),
    [getItemKey, items],
  );

  const estimatedHeights = useMemo(
    () => items.map((item, index) => getItemHeight?.(item, index) ?? rowHeight),
    [getItemHeight, items, rowHeight],
  );

  useEffect(() => {
    const allowedKeys = new Set(itemKeys);

    setMeasuredHeights((current) => {
      let next = current;
      for (const key of Object.keys(current)) {
        if (!allowedKeys.has(key)) {
          if (next === current) {
            next = { ...current };
          }
          delete next[key];
        }
      }

      return next === current ? current : next;
    });
  }, [itemKeys]);

  const itemHeights = useMemo(
    () => itemKeys.map((key, index) => {
      const measured = measuredHeights[key];
      return measured && measured > 0 ? measured : (estimatedHeights[index] ?? rowHeight);
    }),
    [estimatedHeights, itemKeys, measuredHeights, rowHeight],
  );

  const itemOffsets = useMemo(() => {
    let nextOffset = 0;
    return itemHeights.map((height) => {
      const offset = nextOffset;
      nextOffset += height + rowGap;
      return offset;
    });
  }, [itemHeights, rowGap]);

  const [offsetY, visibleRows] = useMemo(() => {
    const resolvedHeight = viewportHeight || initialHeight;
    if (items.length === 0) {
      return [0, [] as Array<VisibleRow>];
    }

    let startIndex = 0;
    while (
      startIndex < items.length
      && itemOffsets[startIndex]! + itemHeights[startIndex]! <= scrollTop
    ) {
      startIndex += 1;
    }
    startIndex = Math.max(0, startIndex - overscan);

    const visibleBottom = scrollTop + resolvedHeight;
    let endIndex = startIndex;
    while (endIndex < items.length && itemOffsets[endIndex]! < visibleBottom) {
      endIndex += 1;
    }

    if (endIndex === startIndex) {
      endIndex = Math.min(items.length, startIndex + 1);
    }

    endIndex = Math.min(items.length, endIndex + overscan);

    return [
      itemOffsets[startIndex] ?? 0,
      items.slice(startIndex, endIndex).map((item, index) => {
        const resolvedIndex = startIndex + index;
        const key = itemKeys[resolvedIndex] ?? (('id' in item && typeof item.id === 'string') ? item.id : `${resolvedIndex}`);

        return {
          item,
          index: resolvedIndex,
          height: itemHeights[resolvedIndex] ?? rowHeight,
          key,
        };
      }),
    ];
  }, [initialHeight, itemHeights, itemKeys, itemOffsets, overscan, rowHeight, scrollTop, viewportHeight, rowGap, items]);

  const totalHeight = Math.max(
    itemHeights.reduce((sum, height) => sum + height + rowGap, 0),
    viewportHeight || initialHeight,
  );
  const resolvedHeight = viewportHeight || initialHeight;

  const setRowRef = (key: string) => (node: HTMLDivElement | null) => {
    if (node) {
      rowRefs.current.set(key, node);
      return;
    }

    rowRefs.current.delete(key);
  };

  useLayoutEffect(() => {
    const applyMeasuredHeights = (nextHeights: MeasuredHeights) => {
      setMeasuredHeights((current) => {
        let next = current;
        for (const [key, measured] of Object.entries(nextHeights)) {
          if (current[key] === measured) continue;
          if (next === current) {
            next = { ...current };
          }
          next[key] = measured;
        }

        return next === current ? current : next;
      });
    };

    const measureRows = () => {
      const updates: MeasuredHeights = {};
      for (const row of visibleRows) {
        const node = rowRefs.current.get(row.key);
        if (!node) {
          continue;
        }

        const measured = Math.ceil(node.getBoundingClientRect().height);
        if (measured > 0) {
          updates[row.key] = measured;
        }
      }

      if (Object.keys(updates).length > 0) {
        applyMeasuredHeights(updates);
      }
    };

    if (typeof ResizeObserver === 'undefined') {
      measureRows();
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const updates: MeasuredHeights = {};

      for (const entry of entries) {
        const key = (entry.target as HTMLDivElement).dataset.sourceBinRowKey;
        if (!key) {
          continue;
        }

        const measured = Math.ceil(entry.contentRect.height);
        if (measured <= 0) {
          continue;
        }

        updates[key] = measured;
      }

      if (Object.keys(updates).length > 0) {
        applyMeasuredHeights(updates);
      }
    });

    for (const row of visibleRows) {
      const node = rowRefs.current.get(row.key);
      if (node) {
        observer.observe(node);
      }
    }

    measureRows();

    return () => {
      observer.disconnect();
    };
  }, [visibleRows]);

  return (
    <div
      ref={viewportRef}
      className={className}
      data-source-bin-virtualized-list=""
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      style={{
        height: resolvedHeight,
        overflowX: 'hidden',
        overflowY: 'auto',
      }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div
          data-source-bin-virtualized-list-inner=""
          style={{
            transform: `translateY(${offsetY}px)`,
            willChange: 'transform',
          }}
        >
          {visibleRows.map(({ key, item, index, height }) => (
            <div
              data-source-bin-virtual-row=""
              data-source-bin-row-key={key}
              key={key}
              ref={setRowRef(key)}
              style={{
                minHeight: height,
                overflow: 'hidden',
                width: '100%',
                boxSizing: 'border-box',
                marginBottom: rowGap,
              }}
            >
              {renderRow(item, index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
