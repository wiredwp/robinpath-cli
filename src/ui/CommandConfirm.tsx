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
    const lineCount = command.split('\n').length;

    useInput((input, key) => {
        const k = input.toLowerCase();
        if (k === 'y' || key.return) onDecision('yes');
        else if (k === 'n' || key.escape) onDecision('no');
        else if (k === 'a' && !isDangerous) onDecision('auto');
        else if (k === 'e') onDecision('edit');
    });

    return (
        <Box flexDirection="column" marginY={0} paddingLeft={1}>
            {isDangerous && <Text color="red">! dangerous command</Text>}
            <Text>
                <Text dimColor>$ </Text>
                <Text>{preview}</Text>
                {lineCount > 1 && <Text dimColor> (+{lineCount - 1} lines)</Text>}
            </Text>
            <Box gap={1}>
                <Text><Text color="green">[y]</Text> run</Text>
                <Text><Text color="red">[n]</Text> skip</Text>
                {!isDangerous && <Text><Text color="cyan">[a]</Text> always</Text>}
                <Text><Text color="cyan">[e]</Text> edit</Text>
            </Box>
        </Box>
    );
}
