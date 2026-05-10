// Specimen 95 integration: Suppress all error alerts/dialogs.
// JS Paint's error handling shows alert() or modal dialogs for any error —
// these are disruptive in an embedded iframe context. Log to console only.

var isIE = /MSIE \d|Trident.*rv:/.test(navigator.userAgent);

window.onerror = function (msg, url, lineNo, columnNo, _error) {
	if (isIE) {
		return false;
	}
	console.warn("[JS Paint] Error:", msg, url, lineNo, columnNo);
	return true;
};

window.onunhandledrejection = function (event) {
	if (isIE) {
		return false;
	}
	console.warn("[JS Paint] Unhandled Rejection:", event.reason);
};

if (isIE) {
	var html =
		"<style>body { text-align: center; font-family: sans-serif; } hr { width: 180px; } .logo { position: relative; top: 3px; }</style>" +
		'<div><h1><img src="images/icons/32x32.png" class="logo"> JS Paint</h1>' +
		"<h2>Internet Explorer is not supported!</h2>" +
		"<p>Try Firefox, Chrome, or Edge.</p></div>";
	var interval = setInterval(function () {
		if (document.body) {
			clearInterval(interval);
			document.body.innerHTML = html;
		}
	}, 100);
}
