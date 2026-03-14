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

function renderTable(tableLines: string[]): React.ReactNode {
    const rows = tableLines
        .filter(l => !l.match(/^\s*\|[-:\s|]+\|\s*$/)) // skip separator row
        .map(l => l.split('|').slice(1, -1).map(cell => cell.trim()));

    if (rows.length === 0) return null;

    // Calculate column widths
    const colCount = rows[0].length;
    const widths = Array(colCount).fill(0);
    for (const row of rows) {
        for (let c = 0; c < Math.min(row.length, colCount); c++) {
            widths[c] = Math.max(widths[c], row[c].length);
        }
    }

    return (
        <Box flexDirection="column" marginY={1}>
            {rows.map((row, ri) => (
                <Text key={ri} bold={ri === 0} dimColor={ri === 0}>
                    {'  '}
                    {row.map((cell, ci) => cell.padEnd(widths[ci] || 0) + '  ').join('')}
                </Text>
            ))}
        </Box>
    );
}

function TextBlock({content}: {content: string}) {
    const lines = content.split('\n');

    // Detect and render tables
    const rendered: React.ReactNode[] = [];
    let i = 0;
    while (i < lines.length) {
        // Check for table (line starts with |)
        if (lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
            const tableStart = i;
            while (i < lines.length && lines[i].trim().startsWith('|')) i++;
            if (i - tableStart >= 2) {
                rendered.push(<React.Fragment key={tableStart}>{renderTable(lines.slice(tableStart, i))}</React.Fragment>);
                continue;
            }
            i = tableStart; // not a table, fall through
        }
        rendered.push(<React.Fragment key={i}>{renderTextLine(lines[i], i)}</React.Fragment>);
        i++;
    }

    return <Box flexDirection="column">{rendered}</Box>;

    function renderTextLine(line: string, idx: number): React.ReactNode {
                const trimmed = line.trimStart();

                // Empty line
                if (!trimmed) return <Text key={idx}> </Text>;

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
                return <Text key={idx} wrap="wrap">{renderInlineMarkdown(line)}</Text>;
    }
}

function CodeBlock({content, lang}: {content: string; lang?: string}) {
    const allLines = content.split('\n');
    const MAX_CODE_LINES = 30;
    const truncated = allLines.length > MAX_CODE_LINES;
    const lines = truncated
        ? [...allLines.slice(0, 20), `… ${allLines.length - 25} more lines`, ...allLines.slice(-5)]
        : allLines;

    // Detect if this is a diff block (has +/- prefixed lines)
    const isDiff = lang === 'diff' || lines.some(l => /^[+-]\s/.test(l) || /^@@/.test(l));

    return (
        <Box flexDirection="column" marginY={0} paddingLeft={2}>
            {lines.map((line, i) => {
                if (isDiff) {
                    if (line.startsWith('+') && !line.startsWith('+++')) {
                        return <Text key={i} backgroundColor="green" color="white">{'  '}{line}</Text>;
                    }
                    if (line.startsWith('-') && !line.startsWith('---')) {
                        return <Text key={i} backgroundColor="red" color="white">{'  '}{line}</Text>;
                    }
                    if (line.startsWith('@@')) {
                        return <Text key={i} color="cyan">{'  '}{line}</Text>;
                    }
                }
                return (
                    <Text key={i}>
                        <Text>{'  '}</Text>
                        <Text>{line}</Text>
                    </Text>
                );
            })}
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
