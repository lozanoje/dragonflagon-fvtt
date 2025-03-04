import { BezierTool, ToolMode } from './tools/BezierTool';
import CircleTool from './tools/CircleTool';
import RectangleTool from './tools/RectangleTool';
import CubicTool from './tools/CubicTool';
import QuadTool from './tools/QuadTool';
import { InputHandler } from './tools/ToolInputHandler';
import PointMapper from './tools/PointMapper';
import SETTINGS from "../../common/Settings";
import { WallData } from '@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs';

declare global {
	namespace PIXI {
		interface InteractionData {
			origin: PIXI.Point;
			destination: PIXI.Point;
		}
	}
}

export enum Mode {
	None,
	Cube,
	Quad,
	Circ,
	Rect
}

const MODE_NAMES: { [key: number]: string } = {};
MODE_NAMES[Mode.None] = 'undefined';
MODE_NAMES[Mode.Cube] = 'beziercube';
MODE_NAMES[Mode.Quad] = 'bezierquad';
MODE_NAMES[Mode.Circ] = 'beziercirc';
MODE_NAMES[Mode.Rect] = 'bezierrect';
class WallPool {
	static readonly walls: Wall[] = [];
	static acquire(wallData: WallData): Wall {
		const result = this.walls.pop() ?? new Wall(new WallDocument(wallData, { parent: canvas.scene }));
		result.data = wallData;
		return result;
	}
	static release(wall: Wall) { this.walls.push(wall); }
}

export class CurvyWallToolManager {
	static readonly PREF_DROP_KEY = 'drop-key';
	private static _instance: CurvyWallToolManager;
	private _mode = Mode.None;
	private wallsLayer: WallsLayer;
	private walls: Wall[] = [];
	private currentHandler?: InputHandler = null;
	private _activeTool?: BezierTool = null;
	private _modeListener: (mode: Mode, toolMode: ToolMode | null) => void = null;
	private _ignoreNextToolModeChange = false;
	private _previousToolData = new Map<Mode, object>([
		[Mode.Cube, { l1: [-100, 0], l2: [100, 0], c1: [-100, -132], c2: [100, -132] }],
		[Mode.Quad, { l1: [-100, 0], l2: [100, 0], c: [0, -132] }],
		[Mode.Circ, { l1: [-100, -100], l2: [100, 100], a1: 0, a2: 0 }],
		[Mode.Rect, { l1: [-100, -100], l2: [100, 100], t: 1, r: 1, b: 1, l: 1 }],
	]);
	private _pointMapper = new PointMapper();

	get segments(): number { return this._activeTool.segments; }
	set segments(value: number) {
		this._activeTool.segments = Math.clamped(value, 1, 64);
		if (this.mode != Mode.None)
			this.render();
	}
	get activeTool(): BezierTool | null { return this._activeTool; }

	private _inPointMapMode = false;
	get currentlyMappingPoints(): boolean { return this._inPointMapMode; }

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	private constructor() { }
	public static get instance(): CurvyWallToolManager {
		return this._instance || (this._instance = new this());
	}

	get mode(): Mode { return this._mode; }
	set mode(value: Mode) {
		if (this._mode === value) return;
		this._ignoreNextToolModeChange = this.activeTool?.mode !== ToolMode.NotPlaced;
		this.clearTool();
		if (this._inPointMapMode)
			this.togglePointMapping();
		this._mode = value;
		if (this._inPointMapMode)
			this._pointMapper.points = [];
		switch (value) {
			case Mode.None:
				this._activeTool = null;
				break;
			case Mode.Cube:
				this._activeTool = new CubicTool();
				break;
			case Mode.Quad:
				this._activeTool = new QuadTool();
				break;
			case Mode.Circ:
				this._activeTool = new CircleTool();
				break;
			case Mode.Rect:
				this._activeTool = new RectangleTool();
				break;
		}
		this._activeTool?.setModeListener((toolMode: ToolMode) => {
			if (this._ignoreNextToolModeChange) {
				this._ignoreNextToolModeChange = false;
				return;
			}
			if (this._modeListener !== null)
				this._modeListener(this._mode, toolMode);
		});
		if (this._modeListener !== null)
			this._modeListener(value, this.activeTool?.mode);
	}
	setModeListener(listener: (mode: Mode, toolMode: ToolMode | null) => void) {
		this._modeListener = listener;
	}

	async apply() {
		if (!this.activeTool || this.activeTool.mode != ToolMode.Placed) return;
		await game.scenes.viewed.createEmbeddedDocuments("Wall", <any>this.walls.map(e => e.data));
		this.clearTool();
	}

	clearTool() {
		if (!this._activeTool) {
			this._ignoreNextToolModeChange = false;
			return;
		}
		this._activeTool.clearTool();
		this.walls = [];
		this.wallsLayer.preview.removeChildren();
		this.render();
	}

	togglePointMapping() {
		this._inPointMapMode = !this._inPointMapMode;
		if (this._inPointMapMode) {
			this._pointMapper.points = [];
			ui.notifications.info(game.i18n.localize(this._pointMapper.getTooltipMessage()), { permanent: true });
		} else {
			ui.notifications.active.forEach(x => x.remove());
			ui.notifications.active = [];
		}
		this.render();
	}
	get canApplyPointMapping(): boolean {
		return this._pointMapper.hasEnoughData();
	}
	applyPointMapping() {
		if (!this._inPointMapMode) return;
		this._inPointMapMode = false;
		this._pointMapper.bindData(this._activeTool);
		(<any>this._activeTool).setMode(ToolMode.Placed);
		ui.notifications.active.forEach(x => x.remove());
		ui.notifications.active = [];
		this.render();
	}

	static _onClickLeft(wrapped: AnyFunction, event: PIXI.InteractionEvent) {
		const self = CurvyWallToolManager.instance;
		if (self._inPointMapMode) {
			if (!self._pointMapper.checkPointForClick(event.data.origin, event))
				return;
			if (self._pointMapper.hasEnoughData())
				self._modeListener(self.mode, ToolMode.NotPlaced);
			self.render();
			return;
		}

		if (self.mode == Mode.None || self.activeTool == null) return wrapped(event);
		if (self.activeTool.checkPointForClick(event.data.origin, event)) {
			self.render();
			return;
		}
		if (event.data.originalEvent.ctrlKey) {
			self.activeTool.startedWithCtrlHeld = true;
		}
		if (SETTINGS.get(CurvyWallToolManager.PREF_DROP_KEY) === 'ctrl' && !event.data.originalEvent.ctrlKey) return;
		if (SETTINGS.get(CurvyWallToolManager.PREF_DROP_KEY) === 'alt' && !event.data.originalEvent.altKey) return;
		self.activeTool.placeTool(event.data.origin, self._previousToolData.get(self._mode));
		self.render();
	}
	static _onDragLeftStart(wrapped: AnyFunction, event: PIXI.InteractionEvent) {
		const self = CurvyWallToolManager.instance;
		if (self._inPointMapMode) {
			self.currentHandler = self._pointMapper.checkPointForDrag(event.data.origin);
			if (self.currentHandler == null) return;
			self.currentHandler.start(event.data.origin, event.data.destination, event);
			self.render();
			return;
		}
		if (self.mode == Mode.None || self.activeTool == null) return wrapped(event);
		self.currentHandler = self.activeTool.checkPointForDrag(event.data.origin);
		if (self.currentHandler == null) return;
		self.currentHandler.start(event.data.origin, event.data.destination, event);
		self.render();
	}
	static _onDragLeftMove(wrapped: AnyFunction, event: PIXI.InteractionEvent) {
		const self = CurvyWallToolManager.instance;
		if (self.mode == Mode.None || !self.currentHandler) return wrapped(event);
		if (self.activeTool.startedWithCtrlHeld && !event.data.originalEvent.ctrlKey) {
			self.activeTool.startedWithCtrlHeld = false;
		}
		self.currentHandler.move(event.data.origin, event.data.destination, event);
		self.render();
	}
	static _onDragLeftDrop(wrapped: AnyFunction, event: PIXI.InteractionEvent) {
		const self = CurvyWallToolManager.instance;
		if (self.mode == Mode.None || !self.currentHandler) return wrapped(event);
		self.activeTool.startedWithCtrlHeld = false;
		self.currentHandler.stop(event.data.origin, event.data.destination, event);
		self.currentHandler = null;
		self.render();
	}
	static _onDragLeftCancel(wrapped: AnyFunction, event: PIXI.InteractionEvent) {
		const self = CurvyWallToolManager.instance;
		if (self.mode == Mode.None) return wrapped(event);
		else if (!self.currentHandler) return;
		self.currentHandler.cancel();
		self.currentHandler = null;
		self.render();
	}
	static _onClickRight(wrapped: AnyFunction, event: PIXI.InteractionEvent) {
		const self = CurvyWallToolManager.instance;
		if (!event.data.originalEvent.ctrlKey || self.mode == Mode.None) return wrapped(event);
		self.mode = Mode.None;
		self.render();
	}

	private graphicsContext = new PIXI.Graphics(null);
	render() {
		this.wallsLayer.preview.removeChildren();
		if (this.currentlyMappingPoints) {
			this._pointMapper.clearContext(this.graphicsContext);
			this.graphicsContext.clear();
			this.graphicsContext.removeChildren();
			this.wallsLayer.preview.addChild(this.graphicsContext);
			this._pointMapper.drawHandles(this.graphicsContext);
			return;
		}

		if (this.activeTool == null) return;
		const pointData = this.activeTool?.getSegments(this.segments);
		if (pointData.length == 0) return;
		this.walls.length;
		const wallData = (<any>this.wallsLayer)._getWallDataFromActiveTool(game.activeTool) as WallData;

		while (this.walls.length > pointData.length - 1) {
			const wall = this.walls.pop();
			WallPool.release(wall);
			this.wallsLayer.preview.removeChild(wall);
		}
		if ((<PIXI.Point>pointData[0]).x !== undefined) {
			const points = pointData as PIXI.Point[];
			for (let c = 0; c < points.length - 1; c++) {
				const data = duplicate(wallData) as WallData;
				data.c = [points[c].x, points[c].y, points[c + 1].x, points[c + 1].y];
				if (c == this.walls.length) {
					this.walls.push(WallPool.acquire(data));
					this.wallsLayer.preview.addChild(this.walls[c]);
					this.walls[c].draw();
				} else {
					this.walls[c].data = data;
					this.wallsLayer.preview.addChild(this.walls[c]);
					this.walls[c].refresh();
				}
			}
		}
		else if ((<PIXI.Point>(<PIXI.Point[]>pointData[0])[0]).x !== undefined) {
			const points = pointData as PIXI.Point[][];
			if (this.walls.length > points.length) {
				const wall = this.walls.pop();
				WallPool.release(wall);
				this.wallsLayer.preview.removeChild(wall);
			}
			for (let c = 0; c < points.length; c++) {
				const data = duplicate(wallData) as WallData;
				data.c = [points[c][0].x, points[c][0].y, points[c][1].x, points[c][1].y];
				if (c == this.walls.length) {
					this.walls.push(WallPool.acquire(data));
					this.wallsLayer.preview.addChild(this.walls[c]);
					this.walls[c].draw();
				} else {
					this.walls[c].data = data;
					this.wallsLayer.preview.addChild(this.walls[c]);
					this.walls[c].refresh();
				}
			}
		}

		this.activeTool.clearContext(this.graphicsContext);
		this.graphicsContext.removeChildren().forEach(x => x.destroy());
		this.graphicsContext.clear();
		this.graphicsContext.visible = true;
		this.wallsLayer.preview.addChild(this.graphicsContext);
		this.activeTool.drawHandles(this.graphicsContext);
		this._previousToolData.set(this._mode, this.activeTool.getData());
	}

	init() {
		libWrapper.register(SETTINGS.MOD_NAME, 'Wall.prototype._onDragLeftStart', (wrapper: any, ...args: any) => {
			this.clearTool();
			wrapper(...args);
		}, 'WRAPPER');
	}

	patchWallsLayer() {
		this.wallsLayer = canvas.walls;
		libWrapper.register(SETTINGS.MOD_NAME, 'WallsLayer.prototype._onClickLeft', CurvyWallToolManager._onClickLeft, 'MIXED');
		libWrapper.register(SETTINGS.MOD_NAME, 'WallsLayer.prototype._onDragLeftStart', CurvyWallToolManager._onDragLeftStart, 'MIXED');
		libWrapper.register(SETTINGS.MOD_NAME, 'WallsLayer.prototype._onDragLeftMove', CurvyWallToolManager._onDragLeftMove, 'MIXED');
		libWrapper.register(SETTINGS.MOD_NAME, 'WallsLayer.prototype._onDragLeftDrop', CurvyWallToolManager._onDragLeftDrop, 'MIXED');
		libWrapper.register(SETTINGS.MOD_NAME, 'WallsLayer.prototype._onDragLeftCancel', CurvyWallToolManager._onDragLeftCancel, 'MIXED');
		libWrapper.register(SETTINGS.MOD_NAME, 'WallsLayer.prototype._onClickRight', CurvyWallToolManager._onClickRight, 'MIXED');
		Hooks.on('requestCurvyWallsRedraw', () => this.render());
	}
}
