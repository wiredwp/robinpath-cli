import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface InputBoxProps {
    placeholder?: string;
    onSubmit: (value: string) => void;
    isActive?: boolean;
}

export function InputBox({ placeholder = 'Ask anything...', onSubmit, isActive = true }: InputBoxProps) {
    const [value, setValue] = useState('');

    useInput((input, key) => {
        if (!isActive) return;

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

        if (input === '\n') { setValue(prev => prev + '\n'); return; }
        if (key.escape) { setValue(''); return; }
        if (input === '\x03') {
            if (value === '') process.exit(0);
            setValue('');
            return;
        }
        if (key.backspace || key.delete) { setValue(prev => prev.slice(0, -1)); return; }
        if (key.tab) return;
        if (input === '\x15') { setValue(''); return; }
        if (input === '\x17') { setValue(prev => prev.replace(/\S+\s*$/, '')); return; }
        if (input && !key.ctrl && !key.meta) { setValue(prev => prev + input); }
    }, { isActive });

    const lines = value.split('\n');
    const isEmpty = value === '';
    const cols = process.stdout.columns || 80;
    const innerWidth = Math.min(cols - 8, 74);

    return (
        <Box flexDirection="column" marginTop={1}>
            <Box
                borderStyle="round"
                borderColor={isActive ? 'cyan' : 'gray'}
                flexDirection="column"
                paddingX={1}
                marginX={1}
            >
                {isEmpty ? (
                    <Text dimColor>{placeholder}</Text>
                ) : (
                    lines.map((line, i) => (
                        <Text key={i}>
                            {line}
                            {i === lines.length - 1 && isActive ? <Text color="cyan">{'█'}</Text> : null}
                        </Text>
                    ))
                )}
            </Box>
            <Box marginX={2} marginTop={0}>
                <Text dimColor>
                    <Text color="gray">enter</Text> send
                    <Text> · </Text>
                    <Text color="gray">\</Text> newline
                    <Text> · </Text>
                    <Text color="gray">esc</Text> clear
                    <Text> · </Text>
                    <Text color="gray">/</Text> commands
                </Text>
            </Box>
        </Box>
    );
}
