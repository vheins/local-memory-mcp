<script lang="ts">
	// Lucide-style icon component — inline SVG, zero runtime overhead
	export let name: string;
	export let size: number = 16;
	export let strokeWidth: number = 1.75;
	export let className: string = "";

	interface IconElement {
		tag: string;
		attrs: Record<string, string>;
	}

	const icons: Record<string, IconElement[]> = {
		// Navigation
		brain: [
			{
				tag: "path",
				attrs: {
					d: "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M17.599 6.5a3 3 0 0 0 .399-1.375"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M6.003 5.125A3 3 0 0 0 6.401 6.5"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M3.477 10.896a4 4 0 0 1 .585-.396"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M19.938 10.5a4 4 0 0 1 .585.396"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M6 18a4 4 0 0 1-1.967-.516"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M19.967 17.484A4 4 0 0 1 18 18"
				}
			}
		],
		"layout-dashboard": [
			{
				tag: "rect",
				attrs: {
					width: "7",
					height: "9",
					x: "3",
					y: "3",
					rx: "1"
				}
			},
			{
				tag: "rect",
				attrs: {
					width: "7",
					height: "5",
					x: "14",
					y: "3",
					rx: "1"
				}
			},
			{
				tag: "rect",
				attrs: {
					width: "7",
					height: "9",
					x: "14",
					y: "12",
					rx: "1"
				}
			},
			{
				tag: "rect",
				attrs: {
					width: "7",
					height: "5",
					x: "3",
					y: "16",
					rx: "1"
				}
			}
		],
		database: [
			{
				tag: "ellipse",
				attrs: {
					cx: "12",
					cy: "5",
					rx: "9",
					ry: "3"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M3 5V19A9 3 0 0 0 21 19V5"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M3 12A9 3 0 0 0 21 12"
				}
			}
		],
		"clipboard-list": [
			{
				tag: "rect",
				attrs: {
					width: "8",
					height: "4",
					x: "8",
					y: "2",
					rx: "1",
					ry: "1"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M12 11h4"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M12 16h4"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M8 11h.01"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M8 16h.01"
				}
			}
		],
		"book-open": [
			{
				tag: "path",
				attrs: {
					d: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"
				}
			}
		],
		// Actions
		"refresh-cw": [
			{
				tag: "path",
				attrs: {
					d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M21 3v5h-5"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M8 16H3v5"
				}
			}
		],
		sun: [
			{
				tag: "circle",
				attrs: {
					cx: "12",
					cy: "12",
					r: "4"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M12 2v2"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M12 20v2"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "m4.93 4.93 1.41 1.41"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "m17.66 17.66 1.41 1.41"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M2 12h2"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M20 12h2"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "m6.34 17.66-1.41 1.41"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "m19.07 4.93-1.41 1.41"
				}
			}
		],
		moon: [
			{
				tag: "path",
				attrs: {
					d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"
				}
			}
		],
		menu: [
			{
				tag: "line",
				attrs: {
					x1: "4",
					x2: "20",
					y1: "12",
					y2: "12"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "4",
					x2: "20",
					y1: "6",
					y2: "6"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "4",
					x2: "20",
					y1: "18",
					y2: "18"
				}
			}
		],
		"chevron-left": [
			{
				tag: "path",
				attrs: {
					d: "m15 18-6-6 6-6"
				}
			}
		],
		"chevron-right": [
			{
				tag: "path",
				attrs: {
					d: "m9 18 6-6-6-6"
				}
			}
		],
		"chevron-down": [
			{
				tag: "path",
				attrs: {
					d: "m6 9 6 6 6-6"
				}
			}
		],
		x: [
			{
				tag: "path",
				attrs: {
					d: "M18 6 6 18"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "m6 6 12 12"
				}
			}
		],
		plus: [
			{
				tag: "path",
				attrs: {
					d: "M5 12h14"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M12 5v14"
				}
			}
		],
		search: [
			{
				tag: "circle",
				attrs: {
					cx: "11",
					cy: "11",
					r: "8"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "m21 21-4.3-4.3"
				}
			}
		],
		pin: [
			{
				tag: "path",
				attrs: {
					d: "M12.586 2.586a2 2 0 0 1 2.828 0l2 2a2 2 0 0 1 0 2.828l-1.793 1.793-.914 4.57a1 1 0 0 1-.271.51l-1.414 1.414a1 1 0 0 1-1.414 0l-2.122-2.121-4.172 4.171a1 1 0 1 1-1.414-1.414l4.171-4.172-2.12-2.12a1 1 0 0 1 0-1.415l1.413-1.414a1 1 0 0 1 .51-.27l4.57-.915 1.792-1.793Z"
				}
			}
		],
		star: [
			{
				tag: "polygon",
				attrs: {
					points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
				}
			}
		],
		edit: [
			{
				tag: "path",
				attrs: {
					d: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"
				}
			}
		],
		trash: [
			{
				tag: "path",
				attrs: {
					d: "M3 6h18"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"
				}
			}
		],
		copy: [
			{
				tag: "rect",
				attrs: {
					width: "14",
					height: "14",
					x: "8",
					y: "8",
					rx: "2",
					ry: "2"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
				}
			}
		],
		"external-link": [
			{
				tag: "path",
				attrs: {
					d: "M15 3h6v6"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M10 14 21 3"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
				}
			}
		],
		filter: [
			{
				tag: "polygon",
				attrs: {
					points: "22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"
				}
			}
		],
		sliders: [
			{
				tag: "line",
				attrs: {
					x1: "4",
					x2: "4",
					y1: "21",
					y2: "14"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "4",
					x2: "4",
					y1: "6",
					y2: "3"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "12",
					x2: "12",
					y1: "21",
					y2: "12"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "12",
					x2: "12",
					y1: "6",
					y2: "3"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "20",
					x2: "20",
					y1: "21",
					y2: "16"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "20",
					x2: "20",
					y1: "10",
					y2: "3"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "1",
					x2: "7",
					y1: "14",
					y2: "14"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "9",
					x2: "15",
					y1: "12",
					y2: "12"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "17",
					x2: "23",
					y1: "16",
					y2: "16"
				}
			}
		],
		// Status / Indicators
		"circle-dot": [
			{
				tag: "circle",
				attrs: {
					cx: "12",
					cy: "12",
					r: "10"
				}
			},
			{
				tag: "circle",
				attrs: {
					cx: "12",
					cy: "12",
					r: "1"
				}
			}
		],
		"circle-check": [
			{
				tag: "circle",
				attrs: {
					cx: "12",
					cy: "12",
					r: "10"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "m9 12 2 2 4-4"
				}
			}
		],
		"circle-x": [
			{
				tag: "circle",
				attrs: {
					cx: "12",
					cy: "12",
					r: "10"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "m15 9-6 6"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "m9 9 6 6"
				}
			}
		],
		"circle-pause": [
			{
				tag: "circle",
				attrs: {
					cx: "12",
					cy: "12",
					r: "10"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "10",
					x2: "10",
					y1: "15",
					y2: "9"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "14",
					x2: "14",
					y1: "15",
					y2: "9"
				}
			}
		],
		"circle-pause-alt": [
			{
				tag: "circle",
				attrs: {
					cx: "12",
					cy: "12",
					r: "10"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M10 9v6"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M14 9v6"
				}
			}
		],
		"triangle-alert": [
			{
				tag: "path",
				attrs: {
					d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M12 9v4"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M12 17h.01"
				}
			}
		],
		check: [
			{
				tag: "path",
				attrs: {
					d: "M20 6 9 17l-5-5"
				}
			}
		],
		info: [
			{
				tag: "circle",
				attrs: {
					cx: "12",
					cy: "12",
					r: "10"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M12 16v-4"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M12 8h.01"
				}
			}
		],
		zap: [
			{
				tag: "path",
				attrs: {
					d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
				}
			}
		],
		activity: [
			{
				tag: "path",
				attrs: {
					d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"
				}
			}
		],
		// Content
		memory: [
			{
				tag: "path",
				attrs: {
					d: "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"
				}
			}
		],
		"git-branch": [
			{
				tag: "line",
				attrs: {
					x1: "6",
					x2: "6",
					y1: "3",
					y2: "15"
				}
			},
			{
				tag: "circle",
				attrs: {
					cx: "18",
					cy: "6",
					r: "3"
				}
			},
			{
				tag: "circle",
				attrs: {
					cx: "6",
					cy: "18",
					r: "3"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M18 9a9 9 0 0 1-9 9"
				}
			}
		],
		tag: [
			{
				tag: "path",
				attrs: {
					d: "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"
				}
			},
			{
				tag: "circle",
				attrs: {
					cx: "7.5",
					cy: "7.5",
					r: ".5",
					fill: "currentColor"
				}
			}
		],
		user: [
			{
				tag: "path",
				attrs: {
					d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"
				}
			},
			{
				tag: "circle",
				attrs: {
					cx: "12",
					cy: "7",
					r: "4"
				}
			}
		],
		bot: [
			{
				tag: "path",
				attrs: {
					d: "M12 8V4H8"
				}
			},
			{
				tag: "rect",
				attrs: {
					width: "16",
					height: "12",
					x: "4",
					y: "8",
					rx: "2"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M2 14h2"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M20 14h2"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M15 13v2"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M9 13v2"
				}
			}
		],
		code: [
			{
				tag: "polyline",
				attrs: {
					points: "16 18 22 12 16 6"
				}
			},
			{
				tag: "polyline",
				attrs: {
					points: "8 6 2 12 8 18"
				}
			}
		],
		terminal: [
			{
				tag: "polyline",
				attrs: {
					points: "4 17 10 11 4 5"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "12",
					x2: "20",
					y1: "19",
					y2: "19"
				}
			}
		],
		"file-text": [
			{
				tag: "path",
				attrs: {
					d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M14 2v4a2 2 0 0 0 2 2h4"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M10 9H8"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M16 13H8"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M16 17H8"
				}
			}
		],
		layers: [
			{
				tag: "path",
				attrs: {
					d: "m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"
				}
			}
		],
		cpu: [
			{
				tag: "rect",
				attrs: {
					x: "4",
					y: "4",
					width: "16",
					height: "16",
					rx: "2"
				}
			},
			{
				tag: "rect",
				attrs: {
					x: "9",
					y: "9",
					width: "6",
					height: "6"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M15 2v2"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M15 20v2"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M2 15h2"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M2 9h2"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M20 15h2"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M20 9h2"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M9 2v2"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M9 20v2"
				}
			}
		],
		clock: [
			{
				tag: "circle",
				attrs: {
					cx: "12",
					cy: "12",
					r: "10"
				}
			},
			{
				tag: "polyline",
				attrs: {
					points: "12 6 12 12 16 14"
				}
			}
		],
		calendar: [
			{
				tag: "rect",
				attrs: {
					width: "18",
					height: "18",
					x: "3",
					y: "4",
					rx: "2",
					ry: "2"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "16",
					x2: "16",
					y1: "2",
					y2: "6"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "8",
					x2: "8",
					y1: "2",
					y2: "6"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "3",
					x2: "21",
					y1: "10",
					y2: "10"
				}
			}
		],
		"arrow-up": [
			{
				tag: "path",
				attrs: {
					d: "m5 12 7-7 7 7"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M12 19V5"
				}
			}
		],
		"arrow-down": [
			{
				tag: "path",
				attrs: {
					d: "M12 5v14"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "m19 12-7 7-7-7"
				}
			}
		],
		"arrow-right": [
			{
				tag: "path",
				attrs: {
					d: "M5 12h14"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "m12 5 7 7-7 7"
				}
			}
		],
		"trending-up": [
			{
				tag: "polyline",
				attrs: {
					points: "22 7 13.5 15.5 8.5 10.5 2 17"
				}
			},
			{
				tag: "polyline",
				attrs: {
					points: "16 7 22 7 22 13"
				}
			}
		],
		"bar-chart": [
			{
				tag: "line",
				attrs: {
					x1: "12",
					x2: "12",
					y1: "20",
					y2: "10"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "18",
					x2: "18",
					y1: "20",
					y2: "4"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "6",
					x2: "6",
					y1: "20",
					y2: "16"
				}
			}
		],
		list: [
			{
				tag: "line",
				attrs: {
					x1: "8",
					x2: "21",
					y1: "6",
					y2: "6"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "8",
					x2: "21",
					y1: "12",
					y2: "12"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "8",
					x2: "21",
					y1: "18",
					y2: "18"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "3",
					x2: "3.01",
					y1: "6",
					y2: "6"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "3",
					x2: "3.01",
					y1: "12",
					y2: "12"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "3",
					x2: "3.01",
					y1: "18",
					y2: "18"
				}
			}
		],
		tool: [
			{
				tag: "path",
				attrs: {
					d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
				}
			}
		],
		columns: [
			{
				tag: "rect",
				attrs: {
					width: "18",
					height: "18",
					x: "3",
					y: "3",
					rx: "2",
					ry: "2"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "12",
					x2: "12",
					y1: "3",
					y2: "21"
				}
			}
		],
		sparkle: [
			{
				tag: "path",
				attrs: {
					d: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
				}
			}
		],
		settings: [
			{
				tag: "path",
				attrs: {
					d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
				}
			},
			{
				tag: "circle",
				attrs: {
					cx: "12",
					cy: "12",
					r: "3"
				}
			}
		],
		wifi: [
			{
				tag: "path",
				attrs: {
					d: "M5 12.55a11 11 0 0 1 14.08 0"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M1.42 9a16 16 0 0 1 21.16 0"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M8.53 16.11a6 6 0 0 1 6.95 0"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "12",
					x2: "12.01",
					y1: "20",
					y2: "20"
				}
			}
		],
		hash: [
			{
				tag: "line",
				attrs: {
					x1: "4",
					x2: "20",
					y1: "9",
					y2: "9"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "4",
					x2: "20",
					y1: "15",
					y2: "15"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "10",
					x2: "8",
					y1: "3",
					y2: "21"
				}
			},
			{
				tag: "line",
				attrs: {
					x1: "16",
					x2: "14",
					y1: "3",
					y2: "21"
				}
			}
		],
		inbox: [
			{
				tag: "polyline",
				attrs: {
					points: "22 12 16 12 14 15 10 15 8 12 2 12"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
				}
			}
		],
		archive: [
			{
				tag: "rect",
				attrs: {
					width: "20",
					height: "5",
					x: "2",
					y: "3",
					rx: "1"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"
				}
			},
			{
				tag: "path",
				attrs: {
					d: "M10 12h4"
				}
			}
		]
	};
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
	aria-hidden="true"
>
	{#if icons[name]}
		{#each icons[name] as element}
			<svelte:element this={element.tag} {...element.attrs} />
		{/each}
	{:else}
		<!-- fallback: question mark circle -->
		<circle cx="12" cy="12" r="10" />
		<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
		<path d="M12 17h.01" />
	{/if}
</svg>
