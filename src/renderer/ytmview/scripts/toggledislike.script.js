(function() {
  const dislikeButton = document.querySelector("ytmusic-like-button-renderer button[aria-label*='dislike' i], ytmusic-like-button-renderer button[aria-label*='beğenme' i]");
  if (dislikeButton) {
    dislikeButton.click();
  }
})
