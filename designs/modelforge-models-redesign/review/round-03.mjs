const task = await taskSpace(33);
const page = task.page("p1");
console.log(await page.evaluate(() => ({
  hash: location.hash,
  drawer: Boolean(document.querySelector(".source-drawer")),
  selectedSource: document.querySelector(".source-choice.selected strong")?.textContent?.trim(),
  inputs: [...document.querySelectorAll(".source-drawer input")].map((node) => ({
    type: node.type,
    name: node.name,
    webkitdirectory: node.webkitdirectory,
    outer: node.outerHTML.slice(0, 220),
  })),
  choices: [...document.querySelectorAll(".source-choice")].map((node) => ({
    source: node.dataset.source,
    text: node.textContent?.trim().replace(/\s+/g, " ").slice(0, 100),
  })),
})));
console.log(await page.snapshot());
