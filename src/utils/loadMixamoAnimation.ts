import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

const mixamoVRMRigMap: Record<string, VRMHumanBoneName> = {
    mixamorigHips: "hips",

    mixamorigSpine: "spine",
    mixamorigSpine1: "chest",
    mixamorigSpine2: "upperChest",

    mixamorigNeck: "neck",
    mixamorigHead: "head",


    mixamorigLeftShoulder: "leftShoulder",
    mixamorigLeftArm: "leftUpperArm",
    mixamorigLeftForeArm: "leftLowerArm",
    mixamorigLeftHand: "leftHand",

    mixamorigRightShoulder: "rightShoulder",
    mixamorigRightArm: "rightUpperArm",
    mixamorigRightForeArm: "rightLowerArm",
    mixamorigRightHand: "rightHand",


    mixamorigLeftUpLeg: "leftUpperLeg",
    mixamorigLeftLeg: "leftLowerLeg",
    mixamorigLeftFoot: "leftFoot",

    mixamorigRightUpLeg: "rightUpperLeg",
    mixamorigRightLeg: "rightLowerLeg",
    mixamorigRightFoot: "rightFoot",

};

export async function loadMixamoAnimation(
    url: string,
    vrm: VRM
): Promise<THREE.AnimationClip> {

    const loader = new FBXLoader();

    const asset = await loader.loadAsync(url);

    const clip = asset.animations[0];

    const tracks: THREE.KeyframeTrack[] = [];

    clip.tracks.forEach((track) => {

        const trackSplitted = track.name.split(".");
        const mixamoRigName = trackSplitted[0];

        const vrmBoneName =
            mixamoVRMRigMap[mixamoRigName];

        if (!vrmBoneName) {
            return;
        }

        const vrmNode =
            vrm.humanoid
                .getNormalizedBoneNode(vrmBoneName);

        if (!vrmNode) {
            return;
        }

        const propertyName = trackSplitted[1];
        if (propertyName !== "quaternion") {
            return;
        }

        if (track instanceof THREE.QuaternionKeyframeTrack) {

            const mixamoNode =
                asset.getObjectByName(mixamoRigName);

            if (!mixamoNode || !mixamoNode.parent) {
                return;
            }

            const restRotationInverse =
                mixamoNode
                    .getWorldQuaternion(
                        new THREE.Quaternion()
                    )
                    .invert();

            const parentRestWorldRotation =
                mixamoNode.parent
                    .getWorldQuaternion(
                        new THREE.Quaternion()
                    );

            const values = track.values.slice();

            for (let i = 0; i < values.length; i += 4) {

                const quat = new THREE.Quaternion(
                    values[i],
                    values[i + 1],
                    values[i + 2],
                    values[i + 3]
                );

                quat
                    .premultiply(parentRestWorldRotation)
                    .multiply(restRotationInverse);

                /*
                if (
                    vrmBoneName === "leftUpperArm"
                ) {
                    quat.multiply(
                        new THREE.Quaternion().setFromEuler(
                            new THREE.Euler(0.0, 0.0, Math.PI / 2 + 0.8)
                        )
                    );
                }

                if (
                    vrmBoneName === "leftLowerArm"
                ) {
                    quat.multiply(
                        new THREE.Quaternion().setFromEuler(
                            new THREE.Euler(0.0, 0.0, 0.5)
                        )
                    );
                }

                if (
                    vrmBoneName === "rightUpperArm"
                ) {
                    quat.multiply(
                        new THREE.Quaternion().setFromEuler(
                            new THREE.Euler(0, 0, -Math.PI / 2 - 0.8)
                        )
                    );
                }

                if (
                    vrmBoneName === "rightLowerArm"
                ) {
                    quat.multiply(
                        new THREE.Quaternion().setFromEuler(
                            new THREE.Euler(0, 0, -0.5)
                        )
                    );
                }
                */

                values[i] = quat.x;
                values[i + 1] = quat.y;
                values[i + 2] = quat.z;
                values[i + 3] = quat.w;
            }

            tracks.push(
                new THREE.QuaternionKeyframeTrack(
                    `${vrmNode.name}.quaternion`,
                    track.times,
                    values
                )
            );
        }
    });



    console.log("Original FBX tracks:", clip.tracks.length);
    console.log("Retargeted VRM tracks:", tracks.length);
    console.log("First original track:", clip.tracks[0]?.name);
    console.log("First retargeted track:", tracks[0]?.name);

    return new THREE.AnimationClip(
        clip.name,
        clip.duration,
        tracks
    );
}