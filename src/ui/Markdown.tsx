/**
 * Simple Markdown renderer for Ink terminal.
 * Handles: code blocks, inline code, bold, bullets, headers.
 */
import React from 'react';
import {Box, Text} from 'ink';

interface MarkdownProps {
    children: string;
}

interface Block {
    type: 'text' | 'code';
    content: string;
    lang?: string;
}

function parseBlocks(text: string): Block[] {
    const blocks: Block[] = [];
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            blocks.push({type: 'text', content: text.slice(lastIndex, match.index)});
        }
        blocks.push({type: 'code', content: match[2].trimEnd(), lang: match[1] || undefined});
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        blocks.push({type: 'text', content: text.slice(lastIndex)});
    }

    return blocks;
}

function renderInlineMarkdown(line: string): React.ReactNode[] {
    const parts: React.ReactNode[] = [];
    let remaining = line;
    let key = 0;

    while (remaining.length > 0) {
        // Bold: **text**
        const boldMatch = remaining.match(/^\*\*(.*?)\*\*/);
        if (boldMatch) {
            parts.push(<Text key={key++} bold>{boldMatch[1]}</Text>);
            remaining = remaining.slice(boldMatch[0].length);
            continue;
        }

        // Inline code: `text`
        const codeMatch = remaining.match(/^`([^`]+)`/);
        if (codeMatch) {
            parts.push(<Text key={key++} color="yellow">{codeMatch[1]}</Text>);
            remaining = remaining.slice(codeMatch[0].length);
            continue;
        }

        // Find next special character
        const nextSpecial = remaining.search(/\*\*|`/);
        if (nextSpecial === -1) {
            parts.push(<Text key={key++}>{remaining}</Text>);
            break;
        }

        parts.push(<Text key={key++}>{remaining.slice(0, nextSpecial)}</Text>);
        remaining = remaining.slice(nextSpecial);
    }

    return parts;
}

function TextBlock({content}: {content: string}) {
    const lines = content.split('\n');

    return (
        <Box flexDirection="column">
            {lines.map((line, i) => {
                const trimmed = line.trimStart();

                // Empty line
                if (!trimmed) return <Text key={i}> </Text>;

                // Header: ## text
                if (trimmed.startsWith('## ')) {
                    return <Text key={i} bold>{trimmed.slice(3)}</Text>;
                }
                if (trimmed.startsWith('# ')) {
                    return <Text key={i} bold>{trimmed.slice(2)}</Text>;
                }

                // Bullet: - text or * text
                if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                    return (
                        <Text key={i}>
                            <Text color="cyan">  • </Text>
                            {renderInlineMarkdown(trimmed.slice(2))}
                        </Text>
                    );
                }

                // Numbered list: 1. text
                const numMatch = trimmed.match(/^(\d+)\.\s/);
                if (numMatch) {
                    return (
                        <Text key={i}>
                            <Text color="cyan">  {numMatch[1]}. </Text>
                            {renderInlineMarkdown(trimmed.slice(numMatch[0].length))}
                        </Text>
                    );
                }

                // Regular text with inline formatting
                return <Text key={i} wrap="wrap">{renderInlineMarkdown(line)}</Text>;
            })}
        </Box>
    );
}

function CodeBlock({content, lang}: {content: string; lang?: string}) {
    const w = Math.min(process.stdout.columns - 6 || 72, 72);
    const allLines = content.split('\n');
    const MAX_CODE_LINES = 30;
    const truncated = allLines.length > MAX_CODE_LINES;
    const lines = truncated
        ? [...allLines.slice(0, 20), `... (${allLines.length - 25} lines hidden)`, ...allLines.slice(-5)]
        : allLines;

    return (
        <Box flexDirection="column" marginY={1} marginX={1}>
            <Text>
                <Text dimColor>{'  ┌'}</Text>
                {lang ? <Text dimColor>{` ${lang} `}</Text> : null}
                <Text dimColor>{'─'.repeat(Math.max(0, w - (lang ? lang.length + 5 : 3)))}</Text>
            </Text>

            {lines.map((line, i) => (
                <Text key={i}>
                    <Text dimColor>{'  │ '}</Text>
                    <Text color="white">{line.slice(0, w - 5)}</Text>
                </Text>
            ))}

            <Text dimColor>{'  └' + '─'.repeat(w - 3)}</Text>
        </Box>
    );
}

export function Markdown({children}: MarkdownProps) {
    const blocks = parseBlocks(children);

    return (
        <Box flexDirection="column">
            {blocks.map((block, i) => (
                block.type === 'code'
                    ? <CodeBlock key={i} content={block.content} lang={block.lang} />
                    : <TextBlock key={i} content={block.content} />
            ))}
        </Box>
    );
}
