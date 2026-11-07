const task = await taskSpace(131);
const pages = await task.pages();
console.log({
  spaceId: task.spaceId,
  pages: await Promise.all(
    pages.map(async (page) => ({
      label: page.label,
      url: await page.url(),
    })),
  ),
});
await task.finish({ keep: [] });
