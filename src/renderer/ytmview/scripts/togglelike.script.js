(function() {
  const likeButton = document.querySelector("ytmusic-like-button-renderer button[aria-label*='like' i], ytmusic-like-button-renderer button[aria-label*='beğen' i]");
  if (likeButton) {
    likeButton.click();
  }
})
