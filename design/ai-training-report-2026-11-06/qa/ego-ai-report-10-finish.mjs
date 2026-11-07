const task = await taskSpace(142);
const pages = await task.pages();
const state = await Promise.all(
  pages.map(async (page) => ({
    label: page.label,
    url: await page.url(),
  })),
);
await task.finish({keep: []});
console.log(JSON.stringify({spaceId: 142, pages: state}, null, 2));
