import React from 'react';
import { Box, Text, useInput } from 'ink';

interface CommandConfirmProps {
    command: string;
    isDangerous: boolean;
    onDecision: (decision: 'yes' | 'no' | 'auto' | 'edit') => void;
}

export function CommandConfirm({ command, isDangerous, onDecision }: CommandConfirmProps) {
    const firstLine = command.split('\n')[0];
    const preview = firstLine.length > 90 ? firstLine.slice(0, 87) + '...' : firstLine;
    const lineCount = command.split('\n').length;

    useInput((input, key) => {
        const k = input.toLowerCase();
        if (k === 'y' || key.return) onDecision('yes');
        else if (k === 'n' || key.escape) onDecision('no');
        else if (k === 'a' && !isDangerous) onDecision('auto');
        else if (k === 'e') onDecision('edit');
    });

    return (
        <Box flexDirection="column" paddingX={2} paddingLeft={3} marginBottom={1}>
            {isDangerous && (
                <Text color="red">{'  !'} dangerous</Text>
            )}
            <Text>
                <Text dimColor>{'  $ '}</Text>
                <Text>{preview}</Text>
                {lineCount > 1 && <Text dimColor>{` (+${lineCount - 1} lines)`}</Text>}
            </Text>
            <Box paddingLeft={4} gap={1}>
                <Text><Text color="green" bold>y</Text><Text dimColor> run</Text></Text>
                <Text><Text color="red" bold>n</Text><Text dimColor> skip</Text></Text>
                {!isDangerous && <Text><Text color="cyan" bold>a</Text><Text dimColor> always</Text></Text>}
                <Text><Text color="cyan" bold>e</Text><Text dimColor> edit</Text></Text>
            </Box>
        </Box>
    );
}
