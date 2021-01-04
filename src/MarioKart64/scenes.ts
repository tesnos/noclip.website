import * as Viewer from '../viewer';
import * as BYML from '../byml';
import * as MIO0 from '../Common/Compression/MIO0';
import * as F3DEX from "../BanjoKazooie/f3dex";

import { GfxDevice, GfxRenderPass, GfxCullMode, GfxProgram, GfxMegaStateDescriptor, makeTextureDescriptor2D, GfxFormat, GfxSampler, GfxTexture, GfxTexFilterMode, GfxMipFilterMode, GfxHostAccessPass, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxBuffer, GfxInputLayout, GfxInputState, GfxBufferUsage, GfxBufferFrequencyHint, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency } from '../gfx/platform/GfxPlatform';
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { GfxRenderInstManager, makeSortKey, GfxRendererLayer, setSortKeyDepth, getSortKeyLayer, executeOnPass } from "../gfx/render/GfxRenderer";
import { BasicRenderTarget, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { TextureMapping, FakeTextureHolder } from '../TextureHolder';
import { computeViewMatrixSkybox, computeViewMatrix, CameraController } from '../Camera';
import { SceneContext } from '../SceneBase';
import { F3DEX_Program, textureToCanvas } from '../BanjoKazooie/render';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { readString } from '../util';


const pathBase = `MarioKart64`;


const enum MK64PASS { SKYBOX, NORMAL }

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2, },
];

class MK64Renderer implements Viewer.SceneGfx {
    public renderHelper: GfxRenderHelper;
    public renderTarget = new BasicRenderTarget();

    public textureHolder = new FakeTextureHolder([]);

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(30/60);
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);



        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const skyPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor);
        executeOnPass(renderInstManager, device, skyPassRenderer, MK64PASS.SKYBOX);
        device.submitPass(skyPassRenderer);

        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);
        executeOnPass(renderInstManager, device, passRenderer, MK64PASS.NORMAL);

        renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
    }
}

class CourseContext {
    static segmentBuffers: ArrayBufferSlice[];
    static sharedOutput: F3DEX.RSPSharedOutput;
}

type CourseArc = {
    Name: number,
    Seg6: ArrayBufferSlice,
    Vtx: ArrayBufferSlice,
    TexRef: ArrayBufferSlice,
    PackDL_Off: number,
    FinalCMD: number,
}

type CommonArc = {
    TexData: ArrayBufferSlice,
}

function loadTextures(arc: CourseArc, block: ArrayBufferSlice) {
    const srcView = block.createDataView();
    const refView = arc.TexRef.createDataView();
    const outView = CourseContext.segmentBuffers[0x05].createDataView();
    let offset = 0;

    for (let i = 0; i < refView.byteLength / 0x10; i++) {
        const texData = MIO0.decompress(block.slice(refView.getUint32((i * 0x10), false))).createDataView();
        const texSize = refView.getUint32((i * 0x10) + 0x08, false);
        for (let j = 0; j < texData.byteLength; j++) {
            outView.setUint8(offset + j, texData.getUint8(j));
        }
        offset += texSize / 2;
    }
}

class SceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(public levelID: number, public name: string) {
        this.id = `${levelID}`;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        /*
        const dataFetcher = context.dataFetcher;
        const romData = await context.dataShare.ensureObject(`${pathBase}/ROMData`, async () => {
            return new ROMData(await dataFetcher.fetchData(`${pathBase}/ROM_arc.crg1`)!);
        });

        

        let mapData = romData.MapData[sceneID];
        if (typeof mapData === 'number')
            mapData = romData.MapData[mapData];
        const map = new Map(decompress(mapData as ArrayBufferSlice));

        const sharedOutput = new RSPSharedOutput();
        const sceneRenderer = new DK64Renderer(device);
        const cache = sceneRenderer.renderHelper.getCache();
        for (let i = 0; i < map.displayLists.length; i++) {
            const dl = map.displayLists[i];

            const segmentBuffers: ArrayBufferSlice[] = [];
            segmentBuffers[0x06] = map.vertBin.slice(dl.VertStartIndex * 0x10);
            segmentBuffers[0x07] = map.f3dexBin;
            const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput);
            initDL(state, true);
            runDL_F3DEX2(state, 0x07000000 | dl.dlStartAddr);

            const output = state.finish();

            if (output === null) {
                // TODO(jstpierre): Warn?
                continue;
            }

            const mesh: Mesh = { sharedOutput, rspState: state, rspOutput: output };
            const meshData = new MeshData(device, cache, mesh);
            sceneRenderer.meshDatas.push(meshData);

            const meshRenderer = new RootMeshRenderer(device, cache, meshData);
            sceneRenderer.meshRenderers.push(meshRenderer);
        }

        for (let i = 0; i < sharedOutput.textureCache.textures.length; i++)
            sceneRenderer.textureHolder.viewerTextures.push(textureToCanvas(sharedOutput.textureCache.textures[i]));
        */
        const dataFetcher = context.dataFetcher;
        const courseArcData = await dataFetcher.fetchData(`${pathBase}/${this.id}_arc.crg1`);
        const courseArc: CourseArc = BYML.parse(courseArcData, BYML.FileType.CRG1);
        const commonArcData = await dataFetcher.fetchData(`${pathBase}/common_arc.crg1`);
        const commonArc: CommonArc = BYML.parse(commonArcData, BYML.FileType.CRG1);

        const renderer = new MK64Renderer(device);

        const sharedOutput = new F3DEX.RSPSharedOutput();
        const segmentBuffers: ArrayBufferSlice[] = [];
        segmentBuffers[0x01] = vertexData;
        segmentBuffers[0x02] = textureData;
        segmentBuffers[0x09] = f3dexData;
        segmentBuffers[0x0B] = textureData;
        segmentBuffers[0x0C] = textureData;
        segmentBuffers[0x0D] = textureData;
        segmentBuffers[0x0E] = textureData;
        segmentBuffers[0x0F] = textureData;

        var rspState = new F3DEX.RSPState(segmentBuffers, sharedOutput);

        renderer.textureHolder.addTextures(device, parseTextureBlock(commonArc.TexData));

        return renderer;
    }

}

const id = `mk64`;
const name = "Mario Kart 64";
const sceneDescs = [

    "Mushroom Cup",
    new SceneDesc(0x08, "Luigi Raceway"),
    new SceneDesc(0x09, "Moo Moo Farm"),
    new SceneDesc(0x06, "Koopa Troopa Beach"),
    new SceneDesc(0x0B, "Kalimari Desert"),

    "Flower Cup",
    new SceneDesc(0x0A, "Toad's Turnpike"),
    new SceneDesc(0x05, "Frappe Snowland"),
    new SceneDesc(0x01, "Choco Mountain"),
    new SceneDesc(0x00, "Mario Raceway"),

    "Star Cup",
    new SceneDesc(0x0E, "Wario Stadium"),
    new SceneDesc(0x0C, "Sherbert Land"),
    new SceneDesc(0x07, "Royal Raceway"),
    new SceneDesc(0x02, "Bowser's Castle"),

    "Special Cup",
    new SceneDesc(0x12, "D.K.'s Jungle Parkway"),
    new SceneDesc(0x04, "Yoshi Valley"),
    new SceneDesc(0x03, "Banshee Boardwalk"),
    new SceneDesc(0x0D, "Rainbow Road"),

    "Battle Courses",
    new SceneDesc(0x13, "Big Donut"),
    new SceneDesc(0x0F, "Block Fort"),
    new SceneDesc(0x11, "Double Deck"),
    new SceneDesc(0x10, "Skyscraper"),

];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };