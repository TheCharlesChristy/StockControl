/**
 * Maps a small input set in stable order while limiting simultaneous remote
 * calls. Stock capture accepts at most five photographs, so batching keeps the
 * implementation deterministic without a long-lived queue or worker pool.
 */
export const mapWithConcurrency = async <Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  operation: (input: Input, index: number) => Promise<Output>,
): Promise<readonly Output[]> => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("concurrency must be a positive integer.");
  }

  const results: Output[] = [];
  for (let offset = 0; offset < inputs.length; offset += concurrency) {
    const batch = inputs.slice(offset, offset + concurrency);
    const completed = await Promise.all(
      batch.map((input, index) => operation(input, offset + index)),
    );
    results.push(...completed);
  }
  return results;
};
