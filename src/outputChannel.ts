import * as vscode from "vscode";

const OUTPUT_CHANNEL_NAME = "MegaLinter";

let outputChannel: vscode.OutputChannel | undefined;

function ts(): string {
  return new Date().toISOString();
}

export function getMegaLinterOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  }
  return outputChannel;
}

export function logMegaLinter(message: string) {
  getMegaLinterOutputChannel().appendLine(`[${ts()}] ${message}`);
}

export function appendMegaLinterOutput(text: string) {
  getMegaLinterOutputChannel().append(text);
}

export function showMegaLinterOutput(preserveFocus = true) {
  getMegaLinterOutputChannel().show(preserveFocus);
}

export function clearMegaLinterOutput() {
  getMegaLinterOutputChannel().clear();
}

export function disposeMegaLinterOutputChannel() {
  outputChannel?.dispose();
  outputChannel = undefined;
}
