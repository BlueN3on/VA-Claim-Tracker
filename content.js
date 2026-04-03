// content.js
// Runs on the VA claim status page.
// Just grabs the claim ID from the URL and stores it.
// The popup does all the fetching and comparison.

const match = window.location.pathname.match(/your-claims\/(\d+)\/status/);
if (match) {
  browser.storage.local.set({ claimId: match[1] });
}
