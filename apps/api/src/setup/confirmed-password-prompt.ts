import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

export type ConfirmedPasswordPromptErrorCode =
  "InteractiveTerminalRequired" | "PasswordConfirmationMismatch";

export class ConfirmedPasswordPromptError extends Error {
  public constructor(public readonly code: ConfirmedPasswordPromptErrorCode) {
    super(code);
    this.name = "ConfirmedPasswordPromptError";
  }
}

class MutedTerminalOutput extends Writable {
  public muted = false;

  public constructor(private readonly destination: NodeJS.WriteStream) {
    super();
  }

  public override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.muted) {
      this.destination.write(chunk);
    }
    callback();
  }
}

export const promptForConfirmedPassword = async (
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
  label: string,
): Promise<string> => {
  if (input.isTTY !== true) {
    throw new ConfirmedPasswordPromptError("InteractiveTerminalRequired");
  }

  const mutedOutput = new MutedTerminalOutput(output);
  const terminal = createInterface({ input, output: mutedOutput, terminal: true });

  const readSecret = async (prompt: string): Promise<string> => {
    output.write(prompt);
    mutedOutput.muted = true;
    try {
      return await terminal.question("");
    } finally {
      mutedOutput.muted = false;
      output.write("\n");
    }
  };

  try {
    const password = await readSecret(`${label}: `);
    const confirmation = await readSecret("Confirm password: ");

    if (password !== confirmation) {
      throw new ConfirmedPasswordPromptError("PasswordConfirmationMismatch");
    }

    return password;
  } finally {
    terminal.close();
  }
};
