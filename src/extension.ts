import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    const localOnlyProvider = new LocalOnlyTreeDataProvider();
    vscode.window.registerTreeDataProvider('gitLocalOnlyView', localOnlyProvider);

    let addToLocalOnlyCmd = vscode.commands.registerCommand('gitLocalOnly.addToLocalOnly', async (uri?: vscode.Uri | any) => {
        const fileUris = getResourceUris(uri);
        if (fileUris.length === 0) {
            vscode.window.showInformationMessage('No file selected to add to Local Only.');
            return;
        }

        for (const fileUri of fileUris) {
            await setSkipWorktree(fileUri.fsPath, true);
        }
        localOnlyProvider.refresh();
        vscode.commands.executeCommand('git.refresh');
    });

    let removeFromLocalOnlyCmd = vscode.commands.registerCommand('gitLocalOnly.removeFromLocalOnly', async (item?: LocalOnlyItem) => {
        if (!item) {
            return;
        }
        await setSkipWorktree(item.resourceUri.fsPath, false);
        localOnlyProvider.refresh();
        vscode.commands.executeCommand('git.refresh');
    });

    let refreshCmd = vscode.commands.registerCommand('gitLocalOnly.refresh', () => {
        localOnlyProvider.refresh();
    });

    context.subscriptions.push(addToLocalOnlyCmd, removeFromLocalOnlyCmd, refreshCmd);
}

function getResourceUris(arg: any): vscode.Uri[] {
    const resources: vscode.Uri[] = [];
    if (!arg) {
        if (vscode.window.activeTextEditor) {
            resources.push(vscode.window.activeTextEditor.document.uri);
        }
    } else if (arg instanceof vscode.Uri) {
        resources.push(arg);
    } else if (arg.resourceUri instanceof vscode.Uri) {
        // SCM resource state
        resources.push(arg.resourceUri);
    } else if (Array.isArray(arg)) {
        for (const a of arg) {
            if (a instanceof vscode.Uri) {
                resources.push(a);
            } else if (a.resourceUri instanceof vscode.Uri) {
                resources.push(a.resourceUri);
            }
        }
    }
    return resources;
}

function setSkipWorktree(filePath: string, skip: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
        const cwd = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.fsPath;
        if (!cwd) {
            resolve();
            return;
        }
        
        const flag = skip ? '--skip-worktree' : '--no-skip-worktree';
        const relativePath = path.relative(cwd, filePath);
        
        cp.exec(`git update-index ${flag} "${relativePath}"`, { cwd }, (error) => {
            if (error) {
                vscode.window.showErrorMessage(`Failed to update local only state: ${error.message}`);
                resolve(); // Still resolve to not break the loop
                return;
            }
            resolve();
        });
    });
}

class LocalOnlyItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.tooltip = this.resourceUri.fsPath;
        this.description = true;
        this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [this.resourceUri]
        };
        
        this.contextValue = 'localOnlyFile';
    }
}

class LocalOnlyTreeDataProvider implements vscode.TreeDataProvider<LocalOnlyItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<LocalOnlyItem | undefined | void> = new vscode.EventEmitter<LocalOnlyItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<LocalOnlyItem | undefined | void> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: LocalOnlyItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: LocalOnlyItem): Promise<LocalOnlyItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return Promise.resolve([]);
        }

        let allLocalOnlyFiles: LocalOnlyItem[] = [];

        for (const folder of workspaceFolders) {
            const files = await this.getSkipWorktreeFiles(folder.uri.fsPath);
            const items = files.map(file => {
                const uri = vscode.Uri.file(path.join(folder.uri.fsPath, file));
                return new LocalOnlyItem(
                    path.basename(file),
                    uri,
                    vscode.TreeItemCollapsibleState.None
                );
            });
            allLocalOnlyFiles = allLocalOnlyFiles.concat(items);
        }

        return allLocalOnlyFiles;
    }

    private getSkipWorktreeFiles(cwd: string): Promise<string[]> {
        return new Promise((resolve) => {
            cp.exec('git ls-files -v', { cwd }, (error, stdout) => {
                if (error) {
                    resolve([]);
                    return;
                }
                
                const files = stdout.split('\n')
                    .map(line => line.trim())
                    .filter(line => line.startsWith('S ') || line.startsWith('h '))
                    .map(line => line.substring(2).trim());
                    
                resolve(files);
            });
        });
    }
}

export function deactivate() {}
