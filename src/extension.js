const vscode = require('vscode')
const fs = require('fs')
const path = require('path')
const { homedir } = require('os')

const clip = require('@ayykamp/napi-clip')

const writeSerializedBlobToFile = (serializeBlob, fileName) => {
  const bytes = new Uint8Array(serializeBlob.split(','))
  fs.writeFileSync(fileName, Buffer.from(bytes))
}

// write every 4 elements from uint8 into one element in uint32
// e.g. [0xff, 0x7f, 0xff, 0x00] => [0xff7fff00]
const copyUint8ArrayToUint32Array = uint8 => {
  if (!uint8)
		throw new TypeError("Missing argument")
  
	let byte1, byte2, byte3, byte4, bits32,
		uint32 = new Uint32Array(uint8.byteLength / 4);
  
	for (let i8 = 0, i32 = 0; i8 <= uint8.length; i32++) {
		byte1 = uint8[i8++]
		byte2 = uint8[i8++]
		byte3 = uint8[i8++]
		byte4 = uint8[i8++]
		bits32 = 0 | (byte1 << 24) | (byte2 << 16) | (byte3 << 8) | byte4
		uint32[i32] = bits32
	}
	return uint32
}

const P_TITLE = 'Polacode 📸'

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const htmlPath = path.resolve(context.extensionPath, 'webview/index.html')

  let lastUsedImageUri = vscode.Uri.file(path.resolve(homedir(), 'Desktop/code.png'))
  let panel

  vscode.window.registerWebviewPanelSerializer('polacode', {
    async deserializeWebviewPanel(_panel, state) {
      panel = _panel
      panel.webview.html = getHtmlContent(htmlPath)
      panel.webview.postMessage({
        type: 'restore',
        innerHTML: state.innerHTML,
        bgColor: context.globalState.get('polacode.bgColor', '#2e3440')
      })
      const selectionListener = setupSelectionSync()
      panel.onDidDispose(() => {
        selectionListener.dispose()
      })
      setupMessageListeners()
    }
  })

  vscode.commands.registerCommand('polacode.activate', () => {
    panel = vscode.window.createWebviewPanel('polacode', P_TITLE, 2, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'webview'))]
    })

    panel.webview.html = getHtmlContent(htmlPath)

    const selectionListener = setupSelectionSync()
    panel.onDidDispose(() => {
      selectionListener.dispose()
    })

    setupMessageListeners()

    const fontFamily = vscode.workspace.getConfiguration('editor').fontFamily
    const bgColor = context.globalState.get('polacode.bgColor', '#2e3440')
    panel.webview.postMessage({
      type: 'init',
      fontFamily,
      bgColor
    })

    syncSettings()
  })

  vscode.commands.registerCommand('polacode.try', () => {
    
  })

  vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('polacode') || e.affectsConfiguration('editor')) {
      syncSettings()
    }
  })

  function setupMessageListeners() {
    panel.webview.onDidReceiveMessage(({ type, data }) => {
      switch (type) {
        case 'shoot':
          vscode.window
            .showSaveDialog({
              defaultUri: lastUsedImageUri,
              filters: {
                Images: ['png']
              }
            })
            .then(uri => {
              if (uri) {
                writeSerializedBlobToFile(data.serializedBlob, uri.fsPath)
                lastUsedImageUri = uri
              }
            })
          break
        case 'shootToClipboard':
          const uint32Pixels = copyUint8ArrayToUint32Array(data.pixels)
          try {
            clip.setImage({
              data: Buffer.from(Uint32Array.from(uint32Pixels).buffer),
              spec: {
                width: data.dimensions.width,
                height: data.dimensions.height,
              }
            })
          } catch (error) {
            console.log(error)
          }
          break
        case 'getAndUpdateCacheAndSettings':
          panel.webview.postMessage({
            type: 'restoreBgColor',
            bgColor: context.globalState.get('polacode.bgColor', '#2e3440')
          })

          syncSettings()
          break
        case 'updateBgColor':
          context.globalState.update('polacode.bgColor', data.bgColor)
          break
        case 'invalidPasteContent':
          vscode.window.showInformationMessage(
            'Pasted content is invalid. Only copy from VS Code and check if your shortcuts for copy/paste have conflicts.'
          )
          break
      }
    })
  }

  function syncSettings() {
    const settings = vscode.workspace.getConfiguration('polacode')
    const editorSettings = vscode.workspace.getConfiguration('editor', null)
    panel.webview.postMessage({
      type: 'updateSettings',
      shadow: settings.get('shadow'),
      transparentBackground: settings.get('transparentBackground'),
      backgroundColor: settings.get('backgroundColor'),
      target: settings.get('target'),
      ligature: editorSettings.get('fontLigatures')
    })
  }

  function setupSelectionSync() {
    return vscode.window.onDidChangeTextEditorSelection(e => {
      if (e.selections[0] && !e.selections[0].isEmpty) {
        vscode.commands.executeCommand('editor.action.clipboardCopyAction')
        panel.postMessage({
          type: 'update'
        })
      }
    })
  }
}

function getHtmlContent(htmlPath) {
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8')
  return htmlContent.replace(/script src="([^"]*)"/g, (match, src) => {
    const realSource = 'vscode-resource:' + path.resolve(htmlPath, '..', src)
    return `script src="${realSource}"`
  })
}

exports.activate = activate
