import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface DropdownItem<T = string> {
  label: string;
  value: T;
  description?: string;
  hint?: string;
}

export interface DropdownProps<T = string> {
  title: string;
  items: DropdownItem<T>[];
  initialValue?: T;
  maxVisible?: number;
  onSelect: (value: T) => void;
  onCancel?: () => void;
}

export function Dropdown<T = string>({
  title,
  items,
  initialValue,
  maxVisible = 8,
  onSelect,
  onCancel,
}: DropdownProps<T>): React.ReactElement {
  const initialIndex = Math.max(
    0,
    items.findIndex((item) => item.value === initialValue),
  );
  const [selectedIndex, setSelectedIndex] = useState(initialIndex >= 0 ? initialIndex : 0);

  useInput((input, key) => {
    // Clamp at the ends instead of wrapping around: with a leading/trailing
    // pseudo-item (e.g. "Custom Model ID") wrap-around would jump the cursor
    // there on a single arrow press and Enter would launch an unexpected
    // screen ("the UI breaks" when using /model mid-conversation).
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : Math.max(0, items.length - 1)));
    } else if (key.return) {
      if (items[selectedIndex]) {
        onSelect(items[selectedIndex].value);
      }
    } else if (key.escape || input === 'q') {
      onCancel?.();
    }
  });

  const total = items.length;
  const half = Math.floor(maxVisible / 2);
  let start = Math.max(0, selectedIndex - half);
  const end = Math.min(total, start + maxVisible);
  if (end - start < maxVisible) {
    start = Math.max(0, end - maxVisible);
  }
  const visibleItems = items.slice(start, end);
  const hiddenAbove = start;
  const hiddenBelow = total - end;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      paddingY={0}
      marginY={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ▼ {title}
        </Text>
        <Text dimColor> (Use ↑/↓ to navigate, Enter to select, Esc to close)</Text>
      </Box>

      {hiddenAbove > 0 && (
        <Box paddingLeft={1}>
          <Text dimColor>▲ {hiddenAbove} more above…</Text>
        </Box>
      )}

      {visibleItems.map((item, relIndex) => {
        const index = start + relIndex;
        const isSelected = index === selectedIndex;
        return (
          <Box key={String(item.value)} paddingLeft={1}>
            <Text color={isSelected ? 'green' : 'white'} bold={isSelected}>
              {isSelected ? '❯ ' : '  '}
              {item.label}
            </Text>
            {item.description && (
              <Text dimColor> — {item.description}</Text>
            )}
            {item.hint && (
              <Text color="yellow"> ({item.hint})</Text>
            )}
          </Box>
        );
      })}

      {hiddenBelow > 0 && (
        <Box paddingLeft={1}>
          <Text dimColor>▼ {hiddenBelow} more below…</Text>
        </Box>
      )}
    </Box>
  );
}
