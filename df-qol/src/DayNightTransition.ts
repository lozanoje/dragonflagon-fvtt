import SETTINGS from "../../common/Settings";

export default class DayNightTransition {
	static init() {
		SETTINGS.register('day-night-progress', {
			scope: 'world',
			config: true,
			type: Boolean,
			default: true,
			name: 'DF_QOL.DayNight.ProgressSettingName',
			hint: 'DF_QOL.DayNight.ProgressSettingHint',
			onChange: () => {
				libWrapper.unregister(SETTINGS.MOD_NAME, 'LightingLayer.prototype.animateDarkness');
			}
		});
		if (SETTINGS.get('day-night-progress')) {
			libWrapper.register(SETTINGS.MOD_NAME, 'LightingLayer.prototype.animateDarkness', DayNightTransition._animateDarkness, 'OVERRIDE');
		}
		SETTINGS.register<number>('day-night-duration', {
			scope: 'world',
			config: true,
			type: Number,
			default: 10,
			range: { min: 1, max: 60, step: 1 },
			name: 'DF_QOL.DayNight.DurationSettingName',
			hint: 'DF_QOL.DayNight.DurationSettingHint'
		});
	}
	static async _animateDarkness(this: LightingLayer, target = 1.0, { duration = 10000 } = {}) {
		/***************************************************************************************/
		/** COPYRIGHT START FoundryVTT : foundry.js > LightingLayer.prototype.animateDarkness **/
		/***************************************************************************************/
		const animationName = "lighting.animateDarkness";
		CanvasAnimation.terminateAnimation(animationName);
		if (target === this.darknessLevel) return false;
		if (duration <= 0) return this.refresh(target);
		// Prepare the animation data object
		const animationData = [{
			parent: { darkness: this.darknessLevel },
			attribute: "darkness",
			to: Math.clamped(target, 0, 1)
		}];

		/***************************/
		/** DF QOL ADDITION START **/
		/***************************/
		if (duration === 10000)
			duration = SETTINGS.get('day-night-duration') as number * 1000;
		// Trigger the animation function
		let elapsed = 0.0;
		let last = new Date().getTime();
		/*************************/
		/** DF QOL ADDITION END **/
		/*************************/

		// Trigger the animation function
		return CanvasAnimation.animateLinear(animationData, {
			name: animationName,
			duration: duration,
			ontick: (dt, attributes) => {
				this.refresh(attributes[0].parent);

				/***************************/
				/** DF QOL ADDITION START **/
				/***************************/
				// do not display the transition progress to the PCs, only to GMs
				if (!game.user.isGM) return;
				// show progress here
				const now = new Date().getTime();
				elapsed += now - last;
				last = now;
				const loader = document.getElementById("loading");
				const pct = Math.ceil((elapsed / duration) * 100);
				loader.querySelector("#context").textContent = 'Day/Night Transitioning...';
				(loader.querySelector("#loading-bar") as HTMLElement).style.width = `${pct}%`;
				loader.querySelector("#progress").textContent = `${Math.round(elapsed / 1000)}/${Math.ceil(duration / 1000)} sec`;
				loader.style.display = "block";
				if ((duration - elapsed < 500) && !loader.hidden) $(loader).fadeOut(2000);
				/*************************/
				/** DF QOL ADDITION END **/
				/*************************/
			}
		});
		/*************************************************************************************/
		/** COPYRIGHT END FoundryVTT : foundry.js > LightingLayer.prototype.animateDarkness **/
		/*************************************************************************************/
	}
}