/**
 * Knowledge Graph Neural Renderer — barrel re‑export.
 *
 * All implementation lives under `kg-neural-renderer/`.
 */
export {
	startNeuralAnimation,
	stopNeuralAnimation,
	updateNeuralDimensions,
	updateAnimationData,
	zoomCamera,
	startDragCamera,
	dragCamera,
	endDragCamera,
	resetCamera,
	getZoomPercent,
	isCameraDragging
} from "./kg-neural-renderer/index";
export type { NeuralRenderState } from "./kg-neural-renderer/index";
