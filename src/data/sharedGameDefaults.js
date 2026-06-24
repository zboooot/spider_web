export var SHARED_GAME_DEFAULTS = {
  "panelParams": {
    "webRadius": 1.45,
    "webSegs": 28,
    "webDepth": 11,
    "webStiff": 0.7,
    "radialWobbleScale": 0.55,
    "spiralWobbleScale": 1,
    "moveSpeed": 3.5,
    "idleMoveRatio": 0.06,
    "idleStepThresh": 20,
    "idleStepSpeed": 0.09,
    "idleStepCooldown": 11,
    "idleStepReach": 34,
    "stepSpeed": 0.35,
    "wrapSpeed": 2,
    "stepThresh": 20,
    "restThresh": 66,
    "legStiff": 0.9,
    "jointStiff": 0.8,
    "stickDelayMin": 0.11,
    "stickDelayMax": 0.72,
    "stickCatchRadius": 11,
    "stickMidBias": 1,
    "stickHistory": 23,
    "caterpillarGravity": 2,
    "caterpillarWeight": 5,
    "flyWeight": 3,
    "leafWeight": 2,
    "leafGravityMin": 0.15,
    "leafGravityMax": 1.5,
    "leafMaxSpeed": 2,
    "caterpillarReleaseSec": 4,
    "flyReleaseSec": 3,
    "leafReleaseSec": 0,
    "bgTheme": 0,
    "bgBlur": 25,
    "bgWind": 1,
    "bgRay": 100,
    "bgDarken": 20,
    "bgPurity": 130,
    "bgYOffset": 13,
    "bgPart": 24,
    "bgVol": 40,
    "bgMusicOn": 1,
    "bgLayoutVersion": 3,
    "stubReachRadius": 200,
    "stubSnapRadius": 28,
    "repairPatch": 1
  },
  "waveConfigs": [
    {
      "waves": [
        {
          "label": "1-1 Teaching Opening",
          "question": "What will the spider do if I do nothing?",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "No poop. Very readable opening.",
          "spawnWeights": {
            "boulder": 0.2,
            "bug": 0,
            "drop": 0.8,
            "poop": 0
          },
          "burstMin": 3,
          "burstMax": 4,
          "burstCount": 4,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 180,
          "pauseDuration": 360,
          "burstInterval": 6,
          "fallingDuration": 1200
        },
        {
          "label": "1-2 use to",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.6,
            "bug": 0,
            "drop": 0.4,
            "poop": 0
          },
          "burstMin": 4,
          "burstMax": 6,
          "burstCount": 5,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "pauseDuration": 360,
          "burstInterval": 6,
          "fallingDuration": 1200
        },
        {
          "label": "1-3 first challenge",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.3,
            "bug": 0.4,
            "drop": 0.3,
            "poop": 0
          },
          "burstMin": 4,
          "burstMax": 6,
          "burstCount": 6,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "pauseDuration": 360,
          "burstInterval": 6,
          "fallingDuration": 1200
        }
      ]
    },
    {
      "waves": [
        {
          "burstMin": 3,
          "burstMax": 4,
          "burstCount": 4,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 180,
          "pauseDuration": 360,
          "label": "2-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.2,
            "bug": 0,
            "drop": 0.8,
            "poop": 0
          },
          "burstInterval": 6,
          "fallingDuration": 1200
        },
        {
          "burstMin": 6,
          "burstMax": 7,
          "burstCount": 2,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 240,
          "firstBurstDelay": 0,
          "pauseDuration": 360,
          "label": "2-2 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.8,
            "bug": 0.2,
            "drop": 0,
            "poop": 0
          },
          "burstInterval": 6,
          "fallingDuration": 1200
        },
        {
          "burstMin": 6,
          "burstMax": 7,
          "burstCount": 3,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "pauseDuration": 360,
          "label": "2-3",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0,
            "bug": 0.1,
            "drop": 0.7,
            "poop": 0.2
          },
          "burstInterval": 6,
          "fallingDuration": 1200
        },
        {
          "burstMin": 3,
          "burstMax": 4,
          "burstCount": 5,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "pauseDuration": 360,
          "label": "2-4",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.6,
            "bug": 0,
            "drop": 0.3,
            "poop": 0.2
          },
          "burstInterval": 6,
          "fallingDuration": 1200
        },
        {
          "burstMin": 3,
          "burstMax": 4,
          "burstCount": 5,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "pauseDuration": 360,
          "label": "L2-5 Custom",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.4,
            "bug": 0.2,
            "drop": 0.2,
            "poop": 0.2
          },
          "burstInterval": 6,
          "fallingDuration": 1200
        }
      ]
    },
    {
      "waves": [
        {
          "burstMin": 3,
          "burstMax": 4,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 180,
          "fallingDuration": 1200,
          "pauseDuration": 360,
          "burstCount": 4,
          "label": "1-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0,
            "bug": 0.6,
            "drop": 0.4,
            "poop": 0
          },
          "burstInterval": 6
        },
        {
          "burstMin": 4,
          "burstMax": 6,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "fallingDuration": 1200,
          "pauseDuration": 360,
          "burstCount": 6,
          "label": "1-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.2,
            "bug": 0.6,
            "drop": 0,
            "poop": 0.2
          },
          "burstInterval": 6
        },
        {
          "burstMin": 4,
          "burstMax": 6,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "fallingDuration": 1200,
          "pauseDuration": 360,
          "burstCount": 5,
          "label": "1-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.4,
            "bug": 0.1,
            "drop": 0.3,
            "poop": 0.2
          },
          "burstInterval": 6
        },
        {
          "burstMin": 5,
          "burstMax": 7,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "fallingDuration": 1200,
          "pauseDuration": 360,
          "burstCount": 5,
          "label": "1-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.2,
            "bug": 0.4,
            "drop": 0.4,
            "poop": 0
          },
          "burstInterval": 6
        },
        {
          "burstMin": 4,
          "burstMax": 6,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "fallingDuration": 1200,
          "pauseDuration": 360,
          "burstCount": 5,
          "label": "1-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.4,
            "bug": 0.1,
            "drop": 0.3,
            "poop": 0.2
          },
          "burstInterval": 6
        },
        {
          "burstMin": 5,
          "burstMax": 7,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "fallingDuration": 1200,
          "pauseDuration": 360,
          "burstCount": 5,
          "label": "1-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.3,
            "bug": 0.3,
            "drop": 0.3,
            "poop": 0.1
          },
          "burstInterval": 6
        }
      ]
    },
    {
      "waves": [
        {
          "label": "1-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.6,
            "bug": 0.6,
            "drop": 0.4,
            "poop": 0
          },
          "burstMin": 3,
          "burstMax": 4,
          "burstCount": 4,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 180,
          "pauseDuration": 360,
          "burstInterval": 6,
          "fallingDuration": 1200
        },
        {
          "label": "1-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.2,
            "bug": 0.5,
            "drop": 0.1,
            "poop": 0.2
          },
          "burstMin": 4,
          "burstMax": 6,
          "burstCount": 6,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "pauseDuration": 360,
          "burstInterval": 6,
          "fallingDuration": 1200
        },
        {
          "label": "1-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.4,
            "bug": 0.3,
            "drop": 0.1,
            "poop": 0
          },
          "burstMin": 4,
          "burstMax": 6,
          "burstCount": 5,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "pauseDuration": 360,
          "burstInterval": 6,
          "fallingDuration": 1200
        },
        {
          "label": "1-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.4,
            "bug": 0.4,
            "drop": 0.2,
            "poop": 0.05
          },
          "burstMin": 5,
          "burstMax": 7,
          "burstCount": 6,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "pauseDuration": 360,
          "burstInterval": 6,
          "fallingDuration": 1200
        },
        {
          "label": "1-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.4,
            "bug": 0.1,
            "drop": 0.3,
            "poop": 0.2
          },
          "burstMin": 4,
          "burstMax": 6,
          "burstCount": 6,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "pauseDuration": 360,
          "burstInterval": 6,
          "fallingDuration": 1200
        }
      ]
    },
    {
      "waves": [
        {
          "label": "1-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0,
            "bug": 0.6,
            "drop": 0.4,
            "poop": 0
          },
          "burstMin": 3,
          "burstMax": 4,
          "burstCount": 4,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 180,
          "pauseDuration": 360,
          "burstInterval": 6,
          "fallingDuration": 1200
        },
        {
          "label": "1-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.2,
            "bug": 0.6,
            "drop": 0,
            "poop": 0.2
          },
          "burstMin": 4,
          "burstMax": 6,
          "burstCount": 6,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "pauseDuration": 360,
          "burstInterval": 6,
          "fallingDuration": 1200
        },
        {
          "label": "1-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.4,
            "bug": 0.1,
            "drop": 0.3,
            "poop": 0.2
          },
          "burstMin": 4,
          "burstMax": 6,
          "burstCount": 5,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "pauseDuration": 360,
          "burstInterval": 6,
          "fallingDuration": 1200
        },
        {
          "label": "1-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.2,
            "bug": 0.4,
            "drop": 0.4,
            "poop": 0
          },
          "burstMin": 5,
          "burstMax": 7,
          "burstCount": 5,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "pauseDuration": 360,
          "burstInterval": 6,
          "fallingDuration": 1200
        },
        {
          "label": "1-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.4,
            "bug": 0.1,
            "drop": 0.3,
            "poop": 0.2
          },
          "burstMin": 4,
          "burstMax": 6,
          "burstCount": 5,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "pauseDuration": 360,
          "burstInterval": 6,
          "fallingDuration": 1200
        },
        {
          "label": "1-1 ",
          "question": "",
          "primaryPressure": "collection",
          "secondaryPressure": "low repair",
          "notes": "",
          "spawnWeights": {
            "boulder": 0.3,
            "bug": 0.3,
            "drop": 0.3,
            "poop": 0.1
          },
          "burstMin": 5,
          "burstMax": 7,
          "burstCount": 5,
          "burstIntervalMin": 0,
          "burstIntervalMax": 60,
          "burstGap": 300,
          "firstBurstDelay": 0,
          "pauseDuration": 360,
          "burstInterval": 6,
          "fallingDuration": 1200
        }
      ]
    }
  ],
  "levelConditions": [
    {
      "boulder": 15,
      "bug": 6,
      "drop": 20
    },
    {
      "boulder": 10,
      "bug": 6,
      "drop": 20
    },
    {
      "boulder": 20,
      "bug": 30,
      "drop": 30
    },
    {
      "boulder": 25,
      "bug": 30,
      "drop": 20
    },
    {
      "boulder": 20,
      "bug": 15,
      "drop": 25
    }
  ]
};
