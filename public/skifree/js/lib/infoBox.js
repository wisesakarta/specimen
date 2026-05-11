class InfoBox {
	constructor(data) {
		this.lines = data.initialLines;
		this.top = data.position.top;
		this.right = data.position.right;
		this.bottom = data.position.bottom;
		this.left = data.position.left;
		this.width = data.width;
		this.height = data.height;
	}

	setLines(lines) {
		this.lines = lines;
	}

	draw(_dContext) {
		// Rendering delegated to the Win95 HTML overlay (#sf-hud).
		// Canvas fillText bypassed to maintain design language fidelity.
	}
}

export default InfoBox;
