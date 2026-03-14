import React from 'react';
import { Box, Text, useInput } from 'ink';

interface CommandConfirmProps {
    command: string;
    isDangerous: boolean;
    onDecision: (decision: 'yes' | 'no' | 'auto' | 'edit') => void;
}

export function CommandConfirm({ command, isDangerous, onDecision }: CommandConfirmProps) {
    const firstLine = command.split('\n')[0];
    const preview = firstLine.length > 100 ? firstLine.slice(0, 97) + '...' : firstLine;
    const multiline = command.includes('\n') ? ` (+${command.split('\n').length - 1} lines)` : '';

    useInput((input, key) => {
        const k = input.toLowerCase();
        if (k === 'y' || key.return) onDecision('yes');
        else if (k === 'n' || key.escape) onDecision('no');
        else if (k === 'a' && !isDangerous) onDecision('auto');
        else if (k === 'e') onDecision('edit');
    });

    return (
        <Box flexDirection="column" marginY={0}>
            {isDangerous && (
                <Text color="red">  ! dangerous command</Text>
            )}
            <Text>
                <Text dimColor>  $ </Text>
                <Text>{preview}</Text>
                {multiline && <Text dimColor>{multiline}</Text>}
            </Text>
            <Box>
                <Text>  </Text>
                <Text color="green">[y]</Text><Text> run  </Text>
                <Text color="red">[n]</Text><Text> skip  </Text>
                {!isDangerous && (
                    <><Text color="cyan">[a]</Text><Text> always  </Text></>
                )}
                <Text color="cyan">[e]</Text><Text> edit</Text>
            </Box>
        </Box>
    );
}
