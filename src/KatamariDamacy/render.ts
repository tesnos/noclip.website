
import { GfxDevice, GfxBuffer, GfxInputState, GfxInputLayout, GfxFormat, GfxVertexBufferFrequency, GfxVertexAttributeDescriptor, GfxBufferUsage, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxCullMode, GfxCompareMode, makeTextureDescriptor2D, GfxProgram, GfxMegaStateDescriptor, GfxBlendMode, GfxBlendFactor, GfxInputLayoutBufferDescriptor } from "../gfx/platform/GfxPlatform";
import { BINModel, BINTexture, BINModelSector, BINModelPart, GSConfiguration } from "./bin";
import { DeviceProgram } from "../Program";
import * as Viewer from "../viewer";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { computeViewMatrix } from "../Camera";
import { mat4 } from "gl-matrix";
import { fillMatrix4x3, fillColor, fillMatrix4x2 } from "../gfx/helpers/UniformBufferHelpers";
import { TextureHolder, LoadedTexture, TextureMapping } from "../TextureHolder";
import { nArray, assert } from "../util";
import { GfxRenderInstManager, GfxRendererLayer, setSortKeyLayer } from "../gfx/render/GfxRenderer";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers";
import { GSAlphaCompareMode, GSAlphaFailMode, GSTextureFunction, GSDepthCompareMode, GSTextureFilter, GSPixelStorageFormat, psmToString } from "../Common/PS2/GS";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { AABB } from "../Geometry";

export class KatamariDamacyProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    private static reflectionDeclarations = `
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    vec3 u_LightDirs[2];
    vec3 u_LightColors[3];
};

layout(row_major, std140) uniform ub_ModelParams {
    Mat4x3 u_BoneMatrix[1];
    Mat4x3 u_NormalMatrix[1];
    Mat4x2 u_TextureMatrix[1];
    vec4 u_Color;
};

uniform sampler2D u_Texture[1];

varying vec3 v_Normal;
varying vec2 v_TexCoord;
`;

    public vert = `
${KatamariDamacyProgram.reflectionDeclarations}
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec2 a_TexCoord;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
    v_Normal = normalize(Mul(_Mat4x4(u_NormalMatrix[0]), vec4(a_Normal, 0.0)).xyz);
    v_TexCoord = Mul(_Mat4x4(u_TextureMatrix[0]), vec4(a_TexCoord, 0.0, 1.0)).xy;
}
`;

    constructor(gsConfiguration: GSConfiguration) {
        super();
        this.frag = this.generateFrag(gsConfiguration);
    }

    private generateAlphaCompareOp(atst: GSAlphaCompareMode, lhs: string, rhs: string): string {
        switch (atst) {
        case GSAlphaCompareMode.ALWAYS: return `true`;
        case GSAlphaCompareMode.NEVER: return `false`;
        case GSAlphaCompareMode.LESS: return `${lhs} < ${rhs}`;
        case GSAlphaCompareMode.LEQUAL: return `${lhs} <= ${rhs}`;
        case GSAlphaCompareMode.EQUAL: return `${lhs} == ${rhs}`;
        case GSAlphaCompareMode.GEQUAL: return `${lhs} >= ${rhs}`;
        case GSAlphaCompareMode.GREATER: return `${lhs} > ${rhs}`;
        case GSAlphaCompareMode.NOTEQUAL: return `${lhs} != ${rhs}`;
        }
    }

    private generateAlphaTest(ate: boolean, atst: GSAlphaCompareMode, aref: number, afail: GSAlphaFailMode): string {
        // TODO(jstpierre): What to do about afail?

        const floatRef = aref / 0xFF;
        const cmp = this.generateAlphaCompareOp(atst, `t_Color.a`, floatRef.toFixed(5));

        if (ate && afail === 0x00) {
            return `
    if (!(${cmp}))
        discard;
`;
        } else {
            return '';
        }
    }

    private generateFrag(gsConfiguration: GSConfiguration): string {
        const tfx: GSTextureFunction = (gsConfiguration.tex0_1_data1 >>> 3) & 0x03;
        assert(tfx === GSTextureFunction.MODULATE);

        // Contains depth & alpha test settings.
        const ate = !!((gsConfiguration.test_1_data0 >>> 0) & 0x01);
        const atst = (gsConfiguration.test_1_data0 >>> 1) & 0x07;
        const aref = (gsConfiguration.test_1_data0 >>> 4) & 0xFF;
        const afail = (gsConfiguration.test_1_data0 >>> 12) & 0x03;
        const date = !!((gsConfiguration.test_1_data0 >>> 14) & 0x01);
        const datm = !!((gsConfiguration.test_1_data0 >>> 15) & 0x01);

        return `
${KatamariDamacyProgram.reflectionDeclarations}
void main() {
    vec4 t_Color;

    t_Color = texture(SAMPLER_2D(u_Texture[0]), v_TexCoord);
    t_Color.rgba *= u_Color.rgba;

#ifdef LIGHTING
    vec3 t_CombinedIntensity = u_LightColors[2];
    float t_intensity = max(dot(v_Normal, u_LightDirs[0]), 0.0);
    t_CombinedIntensity += t_intensity * u_LightColors[0];
    t_intensity = max(dot(v_Normal, u_LightDirs[1]), 0.0);
    t_CombinedIntensity += t_intensity * u_LightColors[1];

    t_Color.rgb *= clamp(t_CombinedIntensity, 0.0, 1.0);
#endif

${this.generateAlphaTest(ate, atst, aref, afail)}

    gl_FragColor = t_Color;
}
`;
    }
}

export class BINModelData {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;

    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, cache: GfxRenderCache, public binModel: BINModel) {
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.binModel.vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, this.binModel.indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: KatamariDamacyProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0*4, format: GfxFormat.F32_RGB },
            { location: KatamariDamacyProgram.a_Normal,   bufferIndex: 0, bufferByteOffset: 3*4, format: GfxFormat.F32_RGB },
            { location: KatamariDamacyProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 6*4, format: GfxFormat.F32_RG },
        ];
        const VERTEX_STRIDE = 3+3+2;
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: VERTEX_STRIDE*4, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;

        this.inputLayout = cache.createInputLayout(device, { vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
    }
}

enum CLAMP1_WM {
    REPEAT, CLAMP, REGION_CLAMP, REGION_REPEAT,
}

function translateWrapMode(wm: CLAMP1_WM): GfxWrapMode {
    switch (wm) {
    case CLAMP1_WM.REPEAT: return GfxWrapMode.REPEAT;
    case CLAMP1_WM.CLAMP: return GfxWrapMode.CLAMP;
    // TODO(jstpierre): Support REGION_* clamp modes.
    case CLAMP1_WM.REGION_REPEAT: return GfxWrapMode.REPEAT;
    default: throw "whoops";
    }
}

function translateDepthCompareMode(cmp: GSDepthCompareMode): GfxCompareMode {
    switch (cmp) {
    case GSDepthCompareMode.NEVER: return GfxCompareMode.NEVER;
    case GSDepthCompareMode.ALWAYS: return GfxCompareMode.ALWAYS;
    // We use a LESS-style depth buffer.
    case GSDepthCompareMode.GEQUAL: return GfxCompareMode.LEQUAL;
    case GSDepthCompareMode.GREATER: return GfxCompareMode.LESS;
    }
}

function translateTextureFilter(filter: GSTextureFilter): [GfxTexFilterMode, GfxMipFilterMode] {
    switch (filter) {
    case GSTextureFilter.NEAREST:
        return [GfxTexFilterMode.POINT,    GfxMipFilterMode.NO_MIP];
    case GSTextureFilter.LINEAR:
        return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NO_MIP];
    case GSTextureFilter.NEAREST_MIPMAP_NEAREST:
        return [GfxTexFilterMode.POINT,    GfxMipFilterMode.NEAREST];
    case GSTextureFilter.NEAREST_MIPMAP_LINEAR:
        return [GfxTexFilterMode.POINT,    GfxMipFilterMode.LINEAR];
    case GSTextureFilter.LINEAR_MIPMAP_NEAREST:
        return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NEAREST];
    case GSTextureFilter.LINEAR_MIPMAP_LINEAR:
        return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.LINEAR];
    default: throw new Error();
    }
}

const textureMatrix = mat4.create();
export class BINModelPartInstance {
    private gfxProgram: GfxProgram;
    private hasDynamicTexture: boolean = false;
    private textureMapping = nArray(1, () => new TextureMapping());
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private layer: GfxRendererLayer;

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: KatamariDamacyTextureHolder, public binModelPart: BINModelPart) {
        const gsConfiguration = this.binModelPart.gsConfiguration!;

        const program = new KatamariDamacyProgram(gsConfiguration);
        if (this.binModelPart.lit)
            program.defines.set("LIGHTING", "1");
        this.gfxProgram = cache.createProgram(device, program);

        const zte = !!((gsConfiguration.test_1_data0 >>> 16) & 0x01);
        const ztst: GSDepthCompareMode = (gsConfiguration!.test_1_data0 >>> 17) & 0x03;
        assert(zte);

        this.megaStateFlags = {
            depthCompare: reverseDepthForCompareMode(translateDepthCompareMode(ztst)),
        };

        if (gsConfiguration.alpha_1_data0 === -1) {
            // TODO(jstpierre): What does this mean?
        } else if (gsConfiguration.alpha_1_data0 === 0x44) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            });
        } else if (gsConfiguration.alpha_1_data0 === 0x48) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE,
            });
        } else {
            throw "whoops";
        }

        const ate = !!((gsConfiguration.test_1_data0 >>> 0) & 0x01);
        if (!ate)
            this.layer = GfxRendererLayer.TRANSLUCENT;

        if (this.binModelPart.textureName !== null) {
            this.hasDynamicTexture = this.binModelPart.textureName.endsWith('/0000/0000');
            if (!this.hasDynamicTexture)
                textureHolder.fillTextureMapping(this.textureMapping[0], this.binModelPart.textureName);
        }

        // Katamari should not have any mipmaps.
        const lcm = (gsConfiguration.tex1_1_data0 >>> 0) & 0x01;
        const mxl = (gsConfiguration.tex1_1_data0 >>> 2) & 0x07;
        assert(lcm === 0x00);
        assert(mxl === 0x00);

        const texMagFilter: GSTextureFilter = (gsConfiguration.tex1_1_data0 >>> 5) & 0x01;
        const texMinFilter: GSTextureFilter = (gsConfiguration.tex1_1_data0 >>> 6) & 0x07;
        const [magFilter]            = translateTextureFilter(texMagFilter);
        const [minFilter, mipFilter] = translateTextureFilter(texMinFilter);

        const wms = (gsConfiguration.clamp_1_data0 >>> 0) & 0x03;
        const wmt = (gsConfiguration.clamp_1_data0 >>> 2) & 0x03;
        const wrapS = translateWrapMode(wms);
        const wrapT = translateWrapMode(wmt);

        this.textureMapping[0].gfxSampler = cache.createSampler(device, {
            minFilter, magFilter, mipFilter,
            wrapS, wrapT,
            minLOD: 0, maxLOD: 100,
        });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, textureHolder: KatamariDamacyTextureHolder, modelViewMatrix: mat4, modelMatrix: mat4): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = setSortKeyLayer(renderInst.sortKey, this.layer);

        if (this.hasDynamicTexture && this.binModelPart.textureName)
            textureHolder.fillTextureMapping(this.textureMapping[0], this.binModelPart.textureName);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        renderInst.drawIndexes(this.binModelPart.indexCount, this.binModelPart.indexOffset);

        if (this.hasDynamicTexture && this.textureMapping[0].flipY) {
            textureMatrix[5] = -1;
            textureMatrix[13] = 1;
        } else {
            mat4.identity(textureMatrix);
        }

        let offs = renderInst.allocateUniformBuffer(KatamariDamacyProgram.ub_ModelParams, 12+12+8+4);
        const mapped = renderInst.mapUniformBufferF32(KatamariDamacyProgram.ub_ModelParams);
        offs += fillMatrix4x3(mapped, offs, modelViewMatrix);
        offs += fillMatrix4x3(mapped, offs, modelMatrix);
        offs += fillMatrix4x2(mapped, offs, textureMatrix);
        offs += fillColor(mapped, offs, this.binModelPart.diffuseColor);
        renderInstManager.submitRenderInst(renderInst);
    }
}

const scratchMatrix = mat4.create();
const scratchAABB = new AABB();
const cullModeFlags = {
    cullMode: GfxCullMode.BACK,
};
export class BINModelInstance {
    public modelMatrix: mat4 = mat4.create();
    public modelParts: BINModelPartInstance[] = [];
    public visible = true;

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: KatamariDamacyTextureHolder, public binModelData: BINModelData) {
        for (let i = 0; i < this.binModelData.binModel.modelParts.length; i++)
            this.modelParts.push(new BINModelPartInstance(device, cache, textureHolder, this.binModelData.binModel.modelParts[i]));
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, textureHolder: KatamariDamacyTextureHolder, viewerInput: Viewer.ViewerRenderInput) {
        if (!this.visible)
            return;

        scratchAABB.transform(this.binModelData.binModel.bbox, this.modelMatrix);
        if (!viewerInput.camera.frustum.contains(scratchAABB))
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.binModelData.inputLayout, this.binModelData.inputState);
        template.setMegaStateFlags(cullModeFlags);

        computeViewMatrix(scratchMatrix, viewerInput.camera);
        mat4.mul(scratchMatrix, scratchMatrix, this.modelMatrix);

        for (let i = 0; i < this.modelParts.length; i++)
            this.modelParts[i].prepareToRender(renderInstManager, textureHolder, scratchMatrix, this.modelMatrix);

        renderInstManager.popTemplateRenderInst();
    }
}

export class BINModelSectorData {
    public modelData: BINModelData[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public binModelSector: BINModelSector) {
        for (let i = 0; i < binModelSector.models.length; i++)
            this.modelData.push(new BINModelData(device, cache, binModelSector.models[i]));
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
    }
}

function textureToCanvas(texture: BINTexture): Viewer.Texture {
    const canvas = document.createElement("canvas");
    const width = texture.width;
    const height = texture.height;
    const name = texture.name;
    canvas.width = width;
    canvas.height = height;
    canvas.title = name;

    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    imgData.data.set(texture.pixels);
    ctx.putImageData(imgData, 0, 0);
    const surfaces = [canvas];

    const extraInfo = new Map<string, string>();
    const psm: GSPixelStorageFormat = (texture.tex0_data0 >>> 20) & 0x3F;
    extraInfo.set('Format', psmToString(psm));

    return { name: name, surfaces, extraInfo };
}

export class KatamariDamacyTextureHolder extends TextureHolder<BINTexture> {
    public addBINTexture(device: GfxDevice, bin: BINModelSector) {
        this.addTextures(device, bin.textures);
    }

    public loadTexture(device: GfxDevice, texture: BINTexture): LoadedTexture {
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
        device.setResourceName(gfxTexture, texture.name);
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [texture.pixels]);
        device.submitPass(hostAccessPass);

        const viewerTexture: Viewer.Texture = textureToCanvas(texture);
        return { gfxTexture, viewerTexture };
    }
}
