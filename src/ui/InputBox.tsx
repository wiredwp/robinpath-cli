import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

interface InputBoxProps {
    placeholder?: string;
    onSubmit: (value: string) => void;
    isActive?: boolean;
}

export function InputBox({ placeholder = 'What do you want to automate today?', onSubmit, isActive = true }: InputBoxProps) {
    const [value, setValue] = useState('');
    const { exit } = useApp();

    useInput((input, key) => {
        if (!isActive) return;

        // Enter — submit or backslash continuation
        if (key.return) {
            if (value.endsWith('\\')) {
                setValue(prev => prev.slice(0, -1) + '\n');
                return;
            }
            const text = value.trim();
            if (text) {
                onSubmit(text);
                setValue('');
            }
            return;
        }

        // Ctrl+J — new line
        if (input === '\n') {
            setValue(prev => prev + '\n');
            return;
        }

        // Escape — clear
        if (key.escape) {
            if (value === '') return;
            setValue('');
            return;
        }

        // Ctrl+C
        if (input === '\x03') {
            if (value === '') {
                exit();
            } else {
                setValue('');
            }
            return;
        }

        // Backspace
        if (key.backspace || key.delete) {
            setValue(prev => prev.slice(0, -1));
            return;
        }

        // Tab — skip
        if (key.tab) return;

        // Ctrl+U — kill line
        if (input === '\x15') { setValue(''); return; }

        // Ctrl+W — delete word
        if (input === '\x17') { setValue(prev => prev.replace(/\S+\s*$/, '')); return; }

        // Regular character
        if (input && !key.ctrl && !key.meta) {
            setValue(prev => prev + input);
        }
    }, { isActive });

    const lines = value.split('\n');
    const isEmpty = value === '';

    return (
        <Box flexDirection="column">
            <Box
                borderStyle="round"
                borderColor={isActive ? 'cyan' : 'gray'}
                flexDirection="column"
                paddingX={1}
                minHeight={3}
            >
                {isEmpty ? (
                    <Text dimColor>{placeholder}</Text>
                ) : (
                    lines.map((line, i) => (
                        <Text key={i}>
                            {line}
                            {i === lines.length - 1 && isActive ? <Text color="cyan">▎</Text> : null}
                        </Text>
                    ))
                )}
            </Box>
            <Box paddingX={1}>
                <Text dimColor>
                    Enter send · \ new line · Ctrl+J newline · /help · Esc clear
                </Text>
            </Box>
        </Box>
    );
}
