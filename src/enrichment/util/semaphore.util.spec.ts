import { Semaphore } from './semaphore.util';

describe('Semaphore', () => {
  it('runs tasks up to the concurrency limit immediately', async () => {
    const semaphore = new Semaphore(2);
    let inFlight = 0;
    let maxInFlight = 0;

    const task = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
    };

    await Promise.all([
      semaphore.run(task),
      semaphore.run(task),
      semaphore.run(task),
      semaphore.run(task),
    ]);

    expect(maxInFlight).toBe(2);
  });

  it('queues excess callers in FIFO order and resolves them as slots free up', async () => {
    const semaphore = new Semaphore(1);
    const completionOrder: number[] = [];

    const makeTask = (id: number, delayMs: number) => async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      completionOrder.push(id);
    };

    await Promise.all([
      semaphore.run(makeTask(1, 20)),
      semaphore.run(makeTask(2, 5)),
      semaphore.run(makeTask(3, 5)),
    ]);

    // With concurrency 1, tasks run strictly one at a time in the order
    // `run` was called, regardless of each task's own delay.
    expect(completionOrder).toEqual([1, 2, 3]);
  });

  it('releases the slot even when the task throws', async () => {
    const semaphore = new Semaphore(1);

    await expect(
      semaphore.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // If the slot wasn't released, this would hang forever.
    let ran = false;
    await semaphore.run(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('returns the task result', async () => {
    const semaphore = new Semaphore(1);
    const result = await semaphore.run(async () => 42);
    expect(result).toBe(42);
  });
});
