// Specimen 95 integration: All error dialogs suppressed for embedded context.
// Errors are logged to console only. JS Paint functions normally after errors.
// Original JS Paint shows modal Win95-style error dialogs for any unhandled
// error/rejection — these are disruptive when Paint is embedded as a sovereign
// citizen inside the Specimen 95 shell.

window.onerror = function (message, source, lineno, colno, error) {
	console.warn("[JS Paint] Error (dialog suppressed):", message, source, lineno, colno, error);
	return true;
};

window.onunhandledrejection = function (event) {
	console.warn("[JS Paint] Unhandled Rejection (dialog suppressed):", event.reason);
};
