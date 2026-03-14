import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

interface InputBoxProps {
    placeholder?: string;
    onSubmit: (value: string) => void;
    isLoading?: boolean;
}

export function InputBox({ placeholder = 'Type a message...', onSubmit, isLoading = false }: InputBoxProps) {
    const [value, setValue] = useState('');
    const [cursorOffset, setCursorOffset] = useState(0);
    const { exit } = useApp();

    useInput((input, key) => {
        if (isLoading) return;

        // Enter — submit
        if (key.return) {
            if (value.endsWith('\\')) {
                // Backslash continuation — add new line
                setValue(prev => prev.slice(0, -1) + '\n');
                setCursorOffset(0);
                return;
            }
            if (value.trim()) {
                onSubmit(value);
                setValue('');
                setCursorOffset(0);
            }
            return;
        }

        // Ctrl+J — new line
        if (input === '\x0A') {
            setValue(prev => prev + '\n');
            setCursorOffset(0);
            return;
        }

        // Escape — clear
        if (key.escape) {
            if (value === '') {
                // Double escape or empty — do nothing
                return;
            }
            setValue('');
            setCursorOffset(0);
            return;
        }

        // Ctrl+C — exit if empty
        if (input === '\x03') {
            if (value === '') {
                exit();
            } else {
                setValue('');
                setCursorOffset(0);
            }
            return;
        }

        // Backspace
        if (key.backspace || key.delete) {
            setValue(prev => prev.slice(0, -1));
            return;
        }

        // Tab — don't insert
        if (key.tab) {
            return;
        }

        // Regular character
        if (input && !key.ctrl && !key.meta) {
            setValue(prev => prev + input);
        }
    });

    const lines = value.split('\n');
    const isEmpty = value === '';
    const cols = process.stdout.columns || 80;
    const boxWidth = Math.min(cols - 4, 76);

    return (
        <Box flexDirection="column">
            <Box
                borderStyle="round"
                borderColor={isLoading ? 'gray' : 'cyan'}
                width={boxWidth}
                flexDirection="column"
                paddingX={1}
                minHeight={3}
            >
                {isEmpty ? (
                    <Text dimColor>{placeholder}</Text>
                ) : (
                    lines.map((line, i) => (
                        <Text key={i}>
                            {i === 0 ? '' : ''}{line}
                            {i === lines.length - 1 && !isLoading ? (
                                <Text color="cyan">▎</Text>
                            ) : null}
                        </Text>
                    ))
                )}
            </Box>
            <Box paddingX={1}>
                <Text dimColor>
                    Enter send · \ new line · /help · Esc clear
                </Text>
            </Box>
        </Box>
    );
}
