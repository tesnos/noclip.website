import * as UI from '../ui';
import * as Viewer from '../viewer';

import {
    GfxDevice, GfxCullMode, GfxBuffer, GfxInputLayout, GfxInputState, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxFormat, GfxVertexBufferFrequency,
    GfxRenderPass, GfxHostAccessPass, GfxBindingLayoutDescriptor, GfxWrapMode, GfxMipFilterMode, GfxTexFilterMode,
    GfxSampler, GfxBlendFactor, GfxBlendMode, GfxTexture, GfxMegaStateDescriptor, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D, GfxBufferFrequencyHint,
} from "../gfx/platform/GfxPlatform";
import { standardFullClearRenderPassDescriptor, BasicRenderTarget, depthClearRenderPassDescriptor, makeClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { DeviceProgram } from '../Program';
import { mat4, vec3, vec4 } from "gl-matrix";
import { SceneGfx, ViewerRenderInput, Texture } from "../viewer";
import { SceneDesc, SceneContext, SceneGroup } from "../SceneBase";
import { executeOnPass } from '../gfx/render/GfxRenderer';
import { TextureHolder, FakeTextureHolder } from '../TextureHolder';
import { hexzero, assert, align } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { CameraController } from '../Camera';
import { EmptyScene } from '../Scenes_Test';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';

interface NJCNK_TriangleStrip {
    vertexCount: number;
    vertexData: Uint16Array;
}

interface NJCNK_TriangleStripList {
    format: number;
    numStrips: number;
    strips: NJCNK_TriangleStrip[];
}

interface NJCNK_VertexChunk {
    type: number;
    vertexCount: number;
    vertexData: ArrayBufferSlice;
}

interface NJCNK_VertexList {
    chunks: NJCNK_VertexChunk[];
}

interface NJCNK_PolygonCommand {
    type: number;
    data: ArrayBufferSlice;
}

interface NJCNK_PolygonCommandList {
    commands: NJCNK_PolygonCommand[];
}

interface NJCNK_Model {
    pList: NJCNK_PolygonCommandList;
    vList: NJCNK_VertexList;
    center: vec3;
    size: number;
}

interface NJCNK_Object {
    flags: number;
    model: NJCNK_Model;
    translation: vec3;
    rotation: vec3;
    scale: vec3;
    child: null;
    sibling: null;
}

enum NJCNK_FLAG {
    NJ_NOTRANSLATION = 0x01,
    NJ_NOROTATION    = 0x02,
    NJ_NOSCALE       = 0x04,
    NJ_NODRAW        = 0x08,
    NJ_NOCHILD       = 0x10,
    NJ_ROTAXIS_SWAP  = 0x20,
    NJ_NOMOTION_A    = 0x40,
    NJ_NOMOTION_B    = 0x80,
}

enum NJCNK_CMD {
    NJCNK_EMPTY = 0x00,

    NJCNK_FLAG_BA = 0x01,
    NJCNK_FLAG_DA = 0x02,
    NJCNK_FLAG_SE = 0x03,
    NJCNK_FLAG_CP = 0x04,
    NJCNK_FLAG_DP = 0x05,

    NJCNK_TEXSET  = 0x08,
    NJCNK_TEXSET2 = 0x09,

    NJCNK_MAT_D    = 0x11,
    NJCNK_MAT_A    = 0x12,
    NJCNK_MAT_DA   = 0x13,
    NJCNK_MAT_S    = 0x14,
    NJCNK_MAT_DS   = 0x15,
    NJCNK_MAT_AS   = 0x16,
    NJCNK_MAT_DAS  = 0x17,
    NJCNK_MAT_BMP  = 0x18,
    NJCNK_MAT_D2   = 0x19,
    NJCNK_MAT_A2   = 0x1A,
    NJCNK_MAT_DA2  = 0x1B,
    NJCNK_MAT_S2   = 0x1C,
    NJCNK_MAT_DS2  = 0x1D,
    NJCNK_MAT_AS2  = 0x1E,
    NJCNK_MAT_DAS2 = 0x1F,

    NJCNK_VTX_SH     = 0x20,
    NJCNK_VTX_N_SH   = 0x21,
    NJCNK_VTX        = 0x22,
    NJCNK_VTX_D      = 0x23,
    NJCNK_VTX_UF     = 0x24,
    NJCNK_VTX_NF     = 0x25,
    NJCNK_VTX_DS     = 0x26,
    NJCNK_VTX_DSA    = 0x27,
    NJCNK_VTX_DSU    = 0x28,
    NJCNK_VTX_N      = 0x29,
    NJCNK_VTX_N_D    = 0x2A,
    NJCNK_VTX_N_UF   = 0x2B,
    NJCNK_VTX_N_NF   = 0x2C,
    NJCNK_VTX_N_DS   = 0x2D,
    NJCNK_VTX_N_DSA  = 0x2E,
    NJCNK_VTX_N_DSU  = 0x2F,
    NJCNK_VTX_N32    = 0x30,
    NJCNK_VTX_N32_D  = 0x31,
    NJCNK_VTX_N32_UF = 0x32,

    NJCNK_VOL_TRI   = 0x38,
    NJCNK_VOL_QUAD  = 0x39,
    NJCNK_VOL_STRIP = 0x40,

    NJCNK_STRIP      = 0x40,
    NJCNK_STRIP_U8   = 0x41,
    NJCNK_STRIP_UA   = 0x42,
    NJCNK_STRIP_N    = 0x43,
    NJCNK_STRIP_N_U8 = 0x44,
    NJCNK_STRIP_N_UA = 0x45,
    NJCNK_STRIP_C    = 0x46,
    NJCNK_STRIP_C_U8 = 0x47,
    NJCNK_STRIP_C_UA = 0x48,
    NJCNK_STRIP_2    = 0x49,
    NJCNK_STRIP_2_U8 = 0x4A,
    NJCNK_STRIP_2_UA = 0x4B,

    NJCNK_END = 0xFF,
}

function getVertexTypeSize(type: number) {
    let size = 0x0C;
         if (type == NJCNK_CMD.NJCNK_VTX_SH  ||
             type == NJCNK_CMD.NJCNK_VTX_D   ||
             type == NJCNK_CMD.NJCNK_VTX_UF  ||
             type == NJCNK_CMD.NJCNK_VTX_NF  ||
             type == NJCNK_CMD.NJCNK_VTX_DS  ||
             type == NJCNK_CMD.NJCNK_VTX_DSA ||
             type == NJCNK_CMD.NJCNK_VTX_DSU ||
             type == NJCNK_CMD.NJCNK_VTX_N32)
             { size = 0x10; }
    else if (type == NJCNK_CMD.NJCNK_VTX_N32_D ||
             type == NJCNK_CMD.NJCNK_VTX_N_UF)
             { size = 0x14; }
    else if (type == NJCNK_CMD.NJCNK_VTX_N)
             { size = 0x18; }
    else if (type == NJCNK_CMD.NJCNK_VTX_N_D   ||
             type == NJCNK_CMD.NJCNK_VTX_N_UF  ||
             type == NJCNK_CMD.NJCNK_VTX_N_NF  ||
             type == NJCNK_CMD.NJCNK_VTX_N_DS  ||
             type == NJCNK_CMD.NJCNK_VTX_N_DSA ||
             type == NJCNK_CMD.NJCNK_VTX_N_DSU)
             { size = 0x1C; }
    else if (type == NJCNK_CMD.NJCNK_VTX_N_SH)
             { size = 0x20; }
                 
    return size;
}

function parseVList(buffer: ArrayBufferSlice, loadAddr: number, addr: number): NJCNK_VertexList {
    const resolvedAddr = addr - loadAddr;
    const view = buffer.createDataView(resolvedAddr);
    
    let chunks = new Array<NJCNK_VertexChunk>();
    let offset = 0x00;
    while (true)
    {
        const cmd = view.getUint16(offset + 0x00) & 0xFF;
        const size = view.getUint16(offset + 0x02);
        if (cmd == NJCNK_CMD.NJCNK_END) {
            break;
        }
        if (0x20 > cmd || cmd > 0x32) {
            console.log("Non-vertex chunk detected in vertex list!");
            offset += 0x04 + (0x02 * size);
            continue;
        }

        const unknown = view.getUint16(offset + 0x04);
        const vertexCount = view.getUint16(offset + 0x06);

        const vertexSize = getVertexTypeSize(cmd);

        chunks.push({type: cmd, vertexCount: vertexCount, vertexData: buffer.slice(offset + 0x08, offset + 0x08 + (vertexCount * vertexSize), true)});
        offset += 0x04 + (0x04 * size);
    }

    return {chunks: chunks};
}

function parsePList(buffer: ArrayBufferSlice, loadAddr: number, addr: number): NJCNK_PolygonCommandList {
    const resolvedAddr = addr - loadAddr;
    const view = buffer.createDataView(resolvedAddr);
    
    let commands = new Array<NJCNK_PolygonCommand>();
    let offset = 0x00;
    while (true)
    {
        const cmd = view.getUint16(offset + 0x00) & 0xFF;
        const size = view.getUint16(offset + 0x02);
        if (cmd == NJCNK_CMD.NJCNK_END) {
            break;
        }
        if (0x20 < cmd && cmd < 0x32) {
            console.log("Vertex chunk detected in PolygonCommand list!");
            offset += 0x04 + (0x04 * size);
            continue;
        }

        commands.push({type: cmd, data: buffer.slice(offset + 0x04, offset + 0x04 + (0x02 * size), true)});
        offset += 0x04 + (0x02 * size);
    }

    return {commands: commands};
}

function parseObject(buffer: ArrayBufferSlice, loadAddr: number, addr: number): NJCNK_Object {
    const resolvedAddr = addr - loadAddr;
    const view = buffer.createDataView(resolvedAddr);

    const flags = view.getUint32(0x00);
    const modelPtr = view.getUint32(0x04);
    const translation = new Float32Array(buffer.arrayBuffer, resolvedAddr + 0x08, 0x0C);
    const rotation = new Float32Array(buffer.arrayBuffer, resolvedAddr + 0x14, 0x0C);
    const scale = new Float32Array(buffer.arrayBuffer, resolvedAddr + 0x20, 0x0C);
    const childPtr = view.getUint32(0x2C);
    const siblingPtr = view.getUint32(0x30);

    const resolvedModelAddr = modelPtr - loadAddr;
    const modelView = buffer.createDataView(resolvedModelAddr);
    const vListPtr = modelView.getUint32(0x00);
    const pListPtr = modelView.getUint32(0x04);
    const center = new Float32Array(buffer.arrayBuffer, resolvedModelAddr + 0x08, 0x0C);
    const size = modelView.getFloat32(0x14);

    const vList = parseVList(buffer, loadAddr, vListPtr);
    const pList = parsePList(buffer, loadAddr, pListPtr);
    const model = {vList: vList, pList: pList, center: center, size: size};

    return {flags: flags, model: model, translation: translation, rotation: rotation, scale: scale, child: null, sibling: null};
}
/*
class JetSetRadioRenderer implements SceneGfx {
    public renderHelper: GfxRenderHelper;
    private renderTarget = new BasicRenderTarget();

    public strIndexToTask: number[] = [];

    public renderPassDescriptor = standardFullClearRenderPassDescriptor;

    private currentTaskIndex: number = -1;

    constructor(device: GfxDevice, private dataHolder: DataHolder) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(128/60);
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setMegaStateFlags(setAttachmentStateSimple({}, {
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
        }));

        let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, 16);
        const d = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);

        template.filterKey = PW64Pass.SKYBOX;
        const skyMatrix = Pilotwings64Renderer.scratchMatrix;
        mat4.copy(skyMatrix, toNoclipSpace);
        skyMatrix[12] = viewerInput.camera.worldMatrix[12];
        skyMatrix[13] = viewerInput.camera.worldMatrix[13] - 5000;
        skyMatrix[14] = viewerInput.camera.worldMatrix[14];
        for (let i = 0; i < this.skyRenderers.length; i++)
            this.skyRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput, skyMatrix);

        template.filterKey = PW64Pass.NORMAL;
        for (let i = 0; i < this.uvtrRenderers.length; i++)
            this.uvtrRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        for (let i = 0; i < this.dobjRenderers.length; i++)
            this.dobjRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput, toNoclipSpace);
        if (this.snowRenderer !== null)
            this.snowRenderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const skyPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, this.renderPassDescriptor);
        
        device.submitPass(skyPassRenderer);

        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);
        

        renderInstManager.resetRenderInsts();
        return skyPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
    }
}
*/

class NJCNKProgram extends DeviceProgram {
    public static a_Position   = 0;
    public static a_Normal     = 1;
    public static a_Diffuse    = 2;
    public static a_Specular   = 3;
    public static a_UserFlags  = 4;
    public static a_NinjaFlags = 5;
    public static a_TexCoord   = 6;
    //public static ub_MaterialParams = 0;
    //public static ub_SceneParams = 1;

    public both = `
precision mediump float;
/*
// Expected to change with each material.
layout(row_major, std140) uniform ub_MaterialParams {
    vec4 u_Diffuse;
    vec4 u_Specular;
};

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x4 u_ModelView;
};
*/
uniform sampler2D u_Texture;
uniform vec4 u_ShaderParams;

varying vec2 v_TexCoord;
varying vec4 v_Color;
varying vec4 v_Specular;
varying vec4 v_Params;
`;

    public vert =`
layout(location = ${NJCNKProgram.a_Position}) attribute vec4 a_Position;
layout(location = ${NJCNKProgram.a_TexCoord}) attribute vec2 a_TexCoord;
layout(location = ${NJCNKProgram.a_Diffuse})  attribute vec4 a_Diffuse;
layout(location = ${NJCNKProgram.a_Specular}) attribute vec4 a_Specular;

void main() {
    float w = 1.0 / a_Position.w;
    gl_Position.x = a_Position.x;
    gl_Position.y = a_Position.y * -1.0;
    gl_Position.w = w;
    if (w >= 0.0 && w < 1.0)
    {
        gl_Position.z = w * 0.1;
    }
    else
    {
        gl_Position.z = 1.0 - (0.1 + 0.9 * a_Position.w);
    }
    gl_Position.xyz *= gl_Position.w;

    v_TexCoord = a_TexCoord;
    v_Color = a_Diffuse;
    v_Specular = a_Specular;
    v_Params = u_ShaderParams;
    v_Params.w = a_Position.z; // toon intensity

    //const float t_ModelScale = 20.0;
    //gl_Position = Mul(u_Projection, Mul(u_ModelView, vec4(a_Position * t_ModelScale, 1.0)));
}
`;
    public frag = `
void main() {
    vec4 out;
    vec4 tex = texture2D(u_Texture, v_TexCoord);
    if (v_Params.w < 0) {
        out = tex * v_Specular;
    }
    else
    {
        out = tex * v_Color;
    }

    gl_FragColor = out;
}
`;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 0, numSamplers: 1 },
];

function makeVertexBufferData(v: NJCNK_VertexList): Float32Array {
    let totalVertexCount = 0;
    for (let i = 0; i < v.chunks.length; i++) { totalVertexCount += v.chunks[i].vertexCount; }
    const buf = new Float32Array(0xE * totalVertexCount);

    let j = 0;
    for (let i = 0; i < v.chunks.length; i++)
    {
        const chunk = v.chunks[i];
        const view = chunk.vertexData.createDataView();
        let l = 0;
        for (let k = 0; k < chunk.vertexCount; k++) {
            // a_Position
            buf[j++] = view.getFloat32((l++) * 0x4);
            buf[j++] = view.getFloat32((l++) * 0x4);
            buf[j++] = view.getFloat32((l++) * 0x4);

            if (chunk.type == NJCNK_CMD.NJCNK_VTX_SH ||
                chunk.type == NJCNK_CMD.NJCNK_VTX_N_SH)
                { l++; }

            // a_Normal
            if (chunk.type == NJCNK_CMD.NJCNK_VTX_N     ||
                chunk.type == NJCNK_CMD.NJCNK_VTX_N_D   ||
                chunk.type == NJCNK_CMD.NJCNK_VTX_N_DS  ||
                chunk.type == NJCNK_CMD.NJCNK_VTX_N_DSA ||
                chunk.type == NJCNK_CMD.NJCNK_VTX_N_DSU ||
                chunk.type == NJCNK_CMD.NJCNK_VTX_N_NF  ||
                chunk.type == NJCNK_CMD.NJCNK_VTX_N_SH  ||
                chunk.type == NJCNK_CMD.NJCNK_VTX_N_UF)
            {
                buf[j++] = view.getFloat32((l++) * 0x4);
                buf[j++] = view.getFloat32((l++) * 0x4);
                buf[j++] = view.getFloat32((l++) * 0x4);
            }
            else if ()
            else
            {
                buf[j++] = 0.0;
                buf[j++] = 0.0;
                buf[j++] = 0.0;
            }

            if (chunk.type == NJCNK_CMD.NJCNK_VTX_N_SH) { l++; }

            // a_Diffuse
            if ()
            {

            }
        }
    }
    return buf;
}

class RenderData {
    public vertexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public vertexBufferData: Float32Array;
    public indexBuffer: GfxBuffer;

    constructor(device: GfxDevice, cache: GfxRenderCache, public sharedOutput: , dynamic = false) {
        this.vertexBufferData = makeVertexBufferData(sharedOutput.vertices);
        if (dynamic) {
            this.vertexBuffer = device.createBuffer(
                align(this.vertexBufferData.byteLength, 4) / 4,
                GfxBufferUsage.VERTEX,
                GfxBufferFrequencyHint.DYNAMIC
            );
        } else {
            this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.vertexBufferData.buffer);
        }
        assert(sharedOutput.vertices.length <= 0xFFFFFFFF);

        const indexBufferData = new Uint32Array(sharedOutput.indices);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexBufferData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: NJCNKProgram.a_Position  , bufferIndex: 0, format: GfxFormat.F32_RGB , bufferByteOffset: 0x03*0x4, },
            { location: NJCNKProgram.a_Normal    , bufferIndex: 0, format: GfxFormat.F32_RGB , bufferByteOffset: 0x00*0x4, },
            { location: NJCNKProgram.a_Diffuse   , bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0x06*0x4, },
            { location: NJCNKProgram.a_Specular  , bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0x0A*0x4, },
            { location: NJCNKProgram.a_UserFlags , bufferIndex: 0, format: GfxFormat.F32_R   , bufferByteOffset: 0x0E*0x4, },
            { location: NJCNKProgram.a_NinjaFlags, bufferIndex: 0, format: GfxFormat.F32_R   , bufferByteOffset: 0x0F*0x4, },
            { location: NJCNKProgram.a_TexCoord  , bufferIndex: 0, format: GfxFormat.F32_RG  , bufferByteOffset: 0x10*0x4, },
        ];

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 0x12*0x4, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U32_R,
            vertexBufferDescriptors,
            vertexAttributeDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

class JetSetRadioRenderer implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderTarget = new BasicRenderTarget();

    constructor(device: GfxDevice, models: NJCNK_Model[]) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(16/60);
    }

    public prepareToRender(device: GfxDevice, hostAcessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setMegaStateFlags({ cullMode: GfxCullMode.BACK });



        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAcessPass);
    }

    public render(device:GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor);
        renderInstManager.drawOnPassRenderer(device, passRenderer);
        renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
    }
}

const pathBase = `JetSetRadio`;
class JetSetRadioSceneDesc implements SceneDesc {
    public id: string;
    constructor(public stage: number, public mission: number, public name: string) {
        this.id = `${stage}:${mission}`;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const renderer = new EmptyScene();
        return renderer;
    }
}

const id = `jsr`;
const name = "Jet Set Radio";
const sceneDescs = [
    'Stage 1',
    new JetSetRadioSceneDesc(1, 1, "Mission 1"),
    new JetSetRadioSceneDesc(1, 2, "Mission 2"),
    new JetSetRadioSceneDesc(1, 3, "Mission 3"),
    new JetSetRadioSceneDesc(1, 4, "Mission 4"),
    new JetSetRadioSceneDesc(1, 5, "Mission 5"),
    new JetSetRadioSceneDesc(1, 6, "Mission 6"),
    new JetSetRadioSceneDesc(1, 7, "Mission 7"),
    new JetSetRadioSceneDesc(1, 8, "Mission 8"),
    new JetSetRadioSceneDesc(1, 9, "Mission 9"),
    new JetSetRadioSceneDesc(1, 10, "Mission 10"),
    new JetSetRadioSceneDesc(1, 11, "Mission 11"),
    new JetSetRadioSceneDesc(1, 12, "Mission 12"),
    'Stage 2',
    new JetSetRadioSceneDesc(2, 1, "Mission 1"),
    new JetSetRadioSceneDesc(2, 2, "Mission 2"),
    new JetSetRadioSceneDesc(2, 3, "Mission 3"),
    new JetSetRadioSceneDesc(2, 4, "Mission 4"),
    new JetSetRadioSceneDesc(2, 5, "Mission 5"),
    new JetSetRadioSceneDesc(2, 6, "Mission 6"),
    new JetSetRadioSceneDesc(2, 7, "Mission 7"),
    new JetSetRadioSceneDesc(2, 8, "Mission 8"),
    new JetSetRadioSceneDesc(2, 9, "Mission 9"),
    new JetSetRadioSceneDesc(2, 10, "Mission 10"),
    new JetSetRadioSceneDesc(2, 11, "Mission 11"),
    new JetSetRadioSceneDesc(2, 12, "Mission 12"),
    'Stage 3',
    new JetSetRadioSceneDesc(3, 1, "Mission 1"),
    new JetSetRadioSceneDesc(3, 2, "Mission 2"),
    new JetSetRadioSceneDesc(3, 3, "Mission 3"),
    new JetSetRadioSceneDesc(3, 4, "Mission 4"),
    new JetSetRadioSceneDesc(3, 5, "Mission 5"),
    new JetSetRadioSceneDesc(3, 6, "Mission 6"),
    new JetSetRadioSceneDesc(3, 7, "Mission 7"),
    new JetSetRadioSceneDesc(3, 8, "Mission 8"),
    new JetSetRadioSceneDesc(3, 9, "Mission 9"),
    new JetSetRadioSceneDesc(3, 10, "Mission 10"),
    new JetSetRadioSceneDesc(3, 11, "Mission 11"),
    new JetSetRadioSceneDesc(3, 12, "Mission 12"),
    'Stage 4',
    new JetSetRadioSceneDesc(4, 1, "Mission 1"),
    new JetSetRadioSceneDesc(4, 2, "Mission 2"),
    new JetSetRadioSceneDesc(4, 3, "Mission 3"),
    new JetSetRadioSceneDesc(4, 4, "Mission 4"),
    new JetSetRadioSceneDesc(4, 5, "Mission 5"),
    new JetSetRadioSceneDesc(4, 6, "Mission 6"),
    'Stage 5',
    new JetSetRadioSceneDesc(5, 1, "Mission 1"),
    new JetSetRadioSceneDesc(5, 2, "Mission 2"),
    new JetSetRadioSceneDesc(5, 3, "Mission 3"),
    new JetSetRadioSceneDesc(5, 4, "Mission 4"),
    new JetSetRadioSceneDesc(5, 5, "Mission 5"),
    new JetSetRadioSceneDesc(5, 6, "Mission 6"),
    'Stage 6',
    new JetSetRadioSceneDesc(6, 1, "Mission 1"),
    new JetSetRadioSceneDesc(6, 2, "Mission 2"),
    new JetSetRadioSceneDesc(6, 3, "Mission 3"),
    new JetSetRadioSceneDesc(6, 4, "Mission 4"),
    new JetSetRadioSceneDesc(6, 5, "Mission 5"),
    new JetSetRadioSceneDesc(6, 6, "Mission 6"),
    'Stage 7',
    new JetSetRadioSceneDesc(7, 1, "Mission 1"),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
