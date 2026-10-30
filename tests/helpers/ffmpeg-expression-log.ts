// SPDX-License-Identifier: Apache-2.0
/** Read only expression print samples, never numeric fields in general logs. */
export function ffmpegExpressionValues(stderr: string): number[] {
  return stderr.split(/\r?\n/u).flatMap((line) => {
    const sample =
      /^(?:\[Eval @ (?:0x)?[0-9a-fA-F]{1,16}\][ \t]+)?(-?[0-9]+\.[0-9]+)[ \t]*$/u.exec(
        line,
      );
    return sample ? [Number(sample[1])] : [];
  });
}
