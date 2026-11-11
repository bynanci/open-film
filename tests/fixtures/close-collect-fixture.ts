import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/** Collect has finished its jobs: a close refusal must remain a failure. */
export async function closeCollectFixture(
  api: string,
  stops: Array<() => Promise<unknown>>,
) {
  const failures: unknown[] = [];
  let request: APIRequestContext | undefined;
  try {
    request = await playwrightRequest.newContext();
    const response = await request.post(`${api}/project/close`, { data: {} });
    expect(response.status()).toBe(200);
  } catch (error) {
    failures.push(error);
  } finally {
    if (request)
      try {
        await request.dispose();
      } catch (error) {
        failures.push(error);
      }
    for (const stop of stops)
      try {
        await stop();
      } catch (error) {
        failures.push(error);
      }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "Collect fixture cleanup failed", {
      cause: failures[0],
    });
}
