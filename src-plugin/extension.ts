import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

  const commands = [
    'edit_investigation',
    'edit_study', 'add_study', 'delete_study',
    'edit_assay', 'add_assay', 'delete_assay',
  ];

  context.subscriptions.push(
    vscode.commands.registerCommand('arc-vs-code.start', () => {
      ARCPanel.createOrShow(context.extensionUri);
    })
  );

  for(let c of commands)
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'arc-vs-code.'+c,
        async (uri: vscode.Uri)=>{
          const panel = await ARCPanel.createOrShow(context.extensionUri);

          let identifier = uri.path.split('/').pop();
          const suffix = c.split('_').map(x=>x[0].toUpperCase()+x.slice(1)).pop();

          if(c.startsWith('add')){
            identifier = await vscode.window.showInputBox({
              placeHolder: `${suffix} Identifier`
            });
            if(!identifier) return;
          } else if (c.startsWith('delete')){
            const response = await vscode.window.showInformationMessage(`Do you want to delete '${identifier}'?`, "Yes", "No");
            if(response!=='Yes') return;
          }
          panel.sendNoWait({api:c, identifier:identifier});
        }
      )
    );
}

function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: [
      vscode.Uri.joinPath(extensionUri, 'dist'),
      vscode.Uri.joinPath(extensionUri, 'resources')
    ]
  };
}

class ARCPanel {
  public static currentPanel: ARCPanel | undefined;

  public static readonly viewType = 'arc-vs-code';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _listeners: Array<(inMessage:any) => void> = [];

  public static async createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it.
    if(ARCPanel.currentPanel){
      ARCPanel.currentPanel._panel.reveal(column);
      return ARCPanel.currentPanel;
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      ARCPanel.viewType,
      'ARC-VS-CODE',
      column || vscode.ViewColumn.One,
      getWebviewOptions(extensionUri),
    );
    ARCPanel.currentPanel = new ARCPanel(panel, extensionUri);

    await ARCPanel.currentPanel.readARC();
    await ARCPanel.currentPanel.send({api:'init'});

    return ARCPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.title = 'ARC-VS-CODE';
    this._extensionUri = extensionUri;

    // Set the webview's initial html content
    this.setHtmlForWebview(this._panel.webview);

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // api listeners
    this._listeners.push(async inMessage=>{
      if(!inMessage.acid || !inMessage.api) return;
      const arc_root = vscode.workspace.workspaceFolders?vscode.workspace.workspaceFolders[0].uri.path:'';
      switch(inMessage.api){
        case 'read':
          console.log('[VS] read '+inMessage.path);
          const data = await vscode.workspace.fs.readFile(
            vscode.Uri.file(arc_root+'/'+inMessage.path)
          );
          return this.sendNoWait({acid:inMessage.acid, data:data});
        case 'write':
          console.log('[VS] write '+inMessage.path);
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(arc_root+'/'+inMessage.path),
            inMessage.data
          );
          return this.sendNoWait({acid:inMessage.acid});
        case 'delete':
          console.log('[VS] delete '+inMessage.path);
          await vscode.workspace.fs.delete(
            vscode.Uri.file(arc_root+'/'+inMessage.path),
            {recursive: true, useTrash: false}
          );
          return this.sendNoWait({acid:inMessage.acid});
      }
    });

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      message => {
        if(!message.acid) return;
        for(let i=this._listeners.length-1; i>=0; i--)
          this._listeners[i](message);
      },
      null,
      this._disposables
    );
  }

  public send(outMessage: any): any{
    return new Promise((resolve,reject)=>{
      outMessage.acid = outMessage.acid || 1+Math.random();
      const listener = (inMessage:any)=>{
        if(inMessage.acid !== outMessage.acid) return;
        const index = this._listeners.indexOf(listener);
        this._listeners.splice(index, 1);
        resolve(inMessage);
      };
      this._listeners.push(listener);
      this._panel.webview.postMessage(outMessage);
    });
  }

  public sendNoWait(outMessage: any): any{
    outMessage.acid = outMessage.acid || 1+Math.random();
    this._panel.webview.postMessage(outMessage);
  }

  public async readARC() {
    const xlsx_uris = await vscode.workspace.findFiles('**/*.xlsx');
    const relative_xlsx_uris = xlsx_uris.map(i=>vscode.workspace.asRelativePath(i));
    await this.send({api:'read_ARC',xlsx_paths:relative_xlsx_uris});
  }

  public dispose() {
    ARCPanel.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private setHtmlForWebview(webview: vscode.Webview) {
    const scriptUri0 = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'js', 'app.js')
    );
    const scriptUri1 = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'js', 'chunk-vendors.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'css', 'app.css')
    );
    const resourceUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'resources')
    );
    webview.html = `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">

        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'self'; img-src *; script-src * 'unsafe-inline'; font-src *; style-src *; frame-src *;"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleUri}" rel="stylesheet">

        <title>ARC Editor</title>
      </head>
      <body>
        <div id="app"></div>
        <script>
          window.vscode = acquireVsCodeApi();
          window.resources_path = "${resourceUri}";
        </script>
        <script defer="defer" src="${scriptUri0}"></script>
        <script defer="defer" src="${scriptUri1}"></script>
      </body>
      </html>`;
  }
}
