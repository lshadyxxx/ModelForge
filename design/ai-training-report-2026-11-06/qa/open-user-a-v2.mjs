const root = "<project-root>/design/ai-training-report-2026-11-06";
const task = await taskSpace("modelforge ai report A v2 review 20261106");
const page = task.page("p1");
await page.goto(`file:///${root}/option-a.html?view=report`, {
  waitUntil: "load",
  timeout: 30000,
});
await page.waitForSelector("details.finding", {state: "visible", timeout: 15000});
console.log({
  spaceId: task.spaceId,
  title: await page.title(),
  url: await page.url(),
});
await task.handOff();
