// Electron cancels app.quit() when a window close handler prevents closing.
// Persist first, then let the second quit pass through without interception.
function gracefulQuit({ app, persist, stop, timeoutMs = 3000 }) {
  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    stop();
    let timer;
    Promise.race([
      Promise.resolve()
        .then(persist)
        .catch((error) =>
          console.warn("Could not save window:", error.message),
        ),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]).finally(() => {
      clearTimeout(timer);
      app.quit();
    });
  });
  return () => quitting;
}
module.exports = { gracefulQuit };
