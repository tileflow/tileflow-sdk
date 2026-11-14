/** Local qualification coordination, separate from the rendered example. */
export function createLineBackgroundControl(origin: string, platform: string) {
  const url = `${origin}/__fixture/line-control?platform=${platform}`;
  return {
    async report(value: unknown) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(value),
      });
      if (!response.ok) throw new Error(`Qualification receiver: ${response.status}`);
    },
    async waitForCapture(index: number, cancelled: () => boolean) {
      const deadline = Date.now() + 120_000;
      while (!cancelled()) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Qualification receiver: ${response.status}`);
        const state = (await response.json()) as {ack?: number};
        if (state.ack === index) return;
        if (Date.now() > deadline) throw new Error('Capture acknowledgement timeout');
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    },
  };
}
