// Initialize Ace Editor
ace.config.set('basePath', 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.7/');

export const editor = ace.edit("preview-content");
editor.setTheme("ace/theme/tomorrow_night_eighties");
editor.setReadOnly(true);
editor.setShowPrintMargin(false);
editor.setOptions({
  fontSize: "13px",
  fontFamily: "var(--font-mono)"
});
