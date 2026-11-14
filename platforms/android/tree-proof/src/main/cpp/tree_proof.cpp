#include <GLES3/gl3.h>
#include <android/log.h>
#include <jni.h>
#include <mln/style/layers/custom_layer_host.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <vector>

// Test-only: fixed placements and plain diffuse colour, using the unchanged TFTM bytes.
class TreeProof : public mln::style::CustomLayerHost {
    struct Vertex { float x, y, z, r, g, b; };
    std::vector<Vertex> vertices;
    GLuint program = 0, buffer = 0, array = 0;

    static GLuint shader(GLenum kind, const char* source) {
        const auto result = glCreateShader(kind);
        glShaderSource(result, 1, &source, nullptr);
        glCompileShader(result);
        GLint ok;
        glGetShaderiv(result, GL_COMPILE_STATUS, &ok);
        if (!ok) { glDeleteShader(result); throw std::runtime_error("Tree shader failed"); }
        return result;
    }

public:
    explicit TreeProof(const std::vector<uint8_t>& bytes) {
        auto u16 = [&](size_t at) { return unsigned(bytes.at(at)) | unsigned(bytes.at(at + 1)) << 8; };
        auto position = [&](size_t at) { return float(int16_t(u16(at))) / 32767 * 2; };
        if (bytes.size() < 16 || std::string(bytes.begin(), bytes.begin() + 4) != "TFTM" || u16(4) != 1)
            throw std::runtime_error("Invalid TFTM header");
        const auto count = u16(6), indices = u16(8) | u16(10) << 16;
        if (count > 4096 || indices > 3000 || bytes.size() != 16 + count * 12 + indices * 2)
            throw std::runtime_error("Invalid TFTM size");
        const float proportion = float(u16(12)) / 1000;
        const std::array<std::array<float, 3>, 4> placements = {{{-10,-22,14},{10,-22,16},{-10,22,22},{10,22,20}}};
        for (const auto& tree : placements) {
            for (unsigned i = 0; i < indices; ++i) {
                const auto index = u16(16 + count * 12 + i * 2);
                if (index >= count) throw std::runtime_error("Invalid TFTM index");
                const auto at = 16 + index * 12;
                const float dot = (-int8_t(bytes[at+6]) - int8_t(bytes[at+7]) + 2 * int8_t(bytes[at+8])) / (127 * std::sqrt(6.f));
                const float light = (0.55f + 0.45f * std::max(0.f, dot)) * (0.65f + 0.35f * bytes[at+11] / 255);
                const bool bark = bytes[at+9] == 0;
                vertices.push_back({tree[0] + position(at) * tree[2] * proportion,
                    tree[1] + position(at+2) * tree[2] * proportion, position(at+4) * tree[2],
                    (bark ? 0.35f : 0.18f) * light, (bark ? 0.20f : 0.50f) * light,
                    (bark ? 0.10f : 0.16f) * light});
            }
        }
    }

    void initialize(const mln::style::CustomLayerInitParameters&) override {
        const auto vertex = shader(GL_VERTEX_SHADER,
            "#version 300 es\nlayout(location=0) in vec3 position; layout(location=1) in vec3 color;"
            "uniform mat4 matrix; out vec3 tint; void main(){gl_Position=matrix*vec4(position,1);tint=color;}");
        const auto fragment = shader(GL_FRAGMENT_SHADER,
            "#version 300 es\nprecision highp float; in vec3 tint; out vec4 color; void main(){color=vec4(tint,1);}");
        program = glCreateProgram();
        glAttachShader(program, vertex); glAttachShader(program, fragment); glLinkProgram(program);
        glDeleteShader(vertex); glDeleteShader(fragment);
        GLint ok; glGetProgramiv(program, GL_LINK_STATUS, &ok);
        if (!ok) throw std::runtime_error("Tree program failed");
        glGenVertexArrays(1, &array); glBindVertexArray(array);
        glGenBuffers(1, &buffer); glBindBuffer(GL_ARRAY_BUFFER, buffer);
        glBufferData(GL_ARRAY_BUFFER, vertices.size() * sizeof(Vertex), vertices.data(), GL_STATIC_DRAW);
        glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex), nullptr);
        glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)(3*sizeof(float)));
        glBindVertexArray(0);
    }

    void render(const mln::style::CustomLayerRenderParameters& camera) override {
        const double world = 512 * std::exp2(camera.zoom), latitude = 40.42 * M_PI / 180;
        const double scale = world / (40075016.68557849 * std::cos(latitude));
        const double x = (180 - 3.7) / 360 * world;
        const double y = (1 - std::asinh(std::tan(latitude)) / M_PI) / 2 * world;
        const auto& p = camera.nearClippedProjectionMatrix;
        std::array<float, 16> matrix{};
        for (int row = 0; row < 4; ++row) {
            matrix[row] = float(p[row] * scale);
            matrix[4+row] = float(p[4+row] * -scale);
            matrix[8+row] = float(p[8+row]);
            matrix[12+row] = float(p[row]*x + p[4+row]*y + p[12+row]);
        }
        glUseProgram(program);
        glBindVertexArray(array);
        glDisable(GL_STENCIL_TEST); glDisable(GL_BLEND); glDisable(GL_CULL_FACE);
        glEnable(GL_DEPTH_TEST); glDepthFunc(GL_LEQUAL); glDepthMask(GL_TRUE); glDepthRangef(0, 1);
        glUniformMatrix4fv(glGetUniformLocation(program, "matrix"), 1, GL_FALSE, matrix.data());
        glDrawArrays(GL_TRIANGLES, 0, GLsizei(vertices.size()));
        glBindVertexArray(0);
        const auto error = glGetError();
        if (error) __android_log_print(ANDROID_LOG_ERROR, "TreeProof", "GL error %u", error);
    }

    void contextLost() override { program = buffer = array = 0; }
    void deinitialize() override {
        glDeleteBuffers(1, &buffer); glDeleteVertexArrays(1, &array); glDeleteProgram(program);
        program = buffer = array = 0;
    }
};

extern "C" JNIEXPORT jlong JNICALL Java_dev_tileflow_sdk_TreeProofBridge_create(JNIEnv* env, jobject, jbyteArray input) {
    std::vector<uint8_t> bytes(env->GetArrayLength(input));
    env->GetByteArrayRegion(input, 0, jsize(bytes.size()), reinterpret_cast<jbyte*>(bytes.data()));
    try { return reinterpret_cast<jlong>(new TreeProof(bytes)); }
    catch (const std::exception& error) {
        env->ThrowNew(env->FindClass("java/lang/IllegalArgumentException"), error.what());
        return 0;
    }
}
