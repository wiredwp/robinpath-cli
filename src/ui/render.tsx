/**
 * Ink renderer — launches the React-based terminal UI.
 * This replaces the old raw-mode REPL for interactive AI mode.
 */
import React from 'react';
import { render } from 'ink';
import { App } from './App';
import type { Message } from './App';

interface RenderOptions {
    model: string;
    mode: string;
    dir: string;
    shell: string;
    projectInfo?: string;
    onMessage: (message: string) => Promise<void>;
    initialPrompt?: string | null;
}

export function renderApp(opts: RenderOptions): {
    unmount: () => void;
    waitUntilExit: () => Promise<void>;
} {
    const { unmount, waitUntilExit } = render(
        <App
            model={opts.model}
            mode={opts.mode}
            dir={opts.dir}
            shell={opts.shell}
            projectInfo={opts.projectInfo}
            onMessage={opts.onMessage}
            initialPrompt={opts.initialPrompt}
        />,
    );

    return { unmount, waitUntilExit };
}

// Re-export for convenience
export type { Message };
