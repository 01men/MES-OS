<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { getRuleHistory, setRule } from '@/api/config2'

/**
 * 标签模板基于规则配置接口版本化存储：
 *   key = surplus.labelTemplate（盈余入库标签）/ receiving.labelTemplate（收料标签）
 *   value = JSON：{ fields: string[], barcode: 'CODE128' | 'QR' }
 */
type TemplateType = 'receiving' | 'surplus'

const TEMPLATE_KEYS: Record<TemplateType, string> = {
  receiving: 'receiving.labelTemplate',
  surplus: 'surplus.labelTemplate'
}

const ALL_FIELDS = [
  { key: 'packageNo', label: '包装号' },
  { key: 'orderNo', label: '订单号' },
  { key: 'materialCode', label: '物料' },
  { key: 'batchNo', label: '批次' },
  { key: 'qty', label: '数量' },
  { key: 'unit', label: '单位' },
  { key: 'supplier', label: '供应商' }
]

/** 预览用示例数据 */
const SAMPLE: Record<string, string> = {
  packageNo: 'PK20260724001',
  orderNo: 'PO-2026-07188',
  materialCode: 'M-100234 五金冲压件',
  batchNo: 'B260724',
  qty: '500',
  unit: 'PCS',
  supplier: '金华示例供应商'
}

const templateType = ref<TemplateType>('receiving')
const state = reactive({
  fields: ['packageNo', 'materialCode', 'batchNo', 'qty', 'unit'] as string[],
  barcode: 'CODE128' as 'CODE128' | 'QR'
})
const currentVersion = ref<number | null>(null)
const saving = ref(false)

async function loadTemplate() {
  currentVersion.value = null
  try {
    const res = await getRuleHistory(TEMPLATE_KEYS[templateType.value])
    const latest = res.data?.[0]
    if (latest) {
      currentVersion.value = latest.version
      try {
        const cfg = JSON.parse(latest.value)
        if (Array.isArray(cfg.fields)) state.fields = cfg.fields.filter((f: string) => ALL_FIELDS.some((d) => d.key === f))
        if (cfg.barcode === 'CODE128' || cfg.barcode === 'QR') state.barcode = cfg.barcode
      } catch {
        ElMessage.warning('现有模板不是合法 JSON，已载入默认配置')
      }
    }
  } catch {
    // key 尚未配置：使用默认值
  }
}

async function save() {
  if (state.fields.length === 0) {
    ElMessage.warning('请至少勾选一个标签字段')
    return
  }
  saving.value = true
  try {
    await setRule(
      TEMPLATE_KEYS[templateType.value],
      JSON.stringify({ fields: state.fields, barcode: state.barcode })
    )
    ElMessage.success('模板已保存为新版本并生效')
    loadTemplate()
  } finally {
    saving.value = false
  }
}

function onTypeChange() {
  loadTemplate()
}

const previewFields = computed(() => ALL_FIELDS.filter((f) => state.fields.includes(f.key)))

/* ---------- 测试打印（仅预览，不产生正式标签号） ---------- */
const printVisible = ref(false)

function testPrint() {
  printVisible.value = true
}

onMounted(loadTemplate)
</script>

<template>
  <div>
    <el-alert
      type="info"
      show-icon
      :closable="false"
      title="标签模板基于规则配置版本化存储（规则配置页可回溯历史版本）。测试打印仅预览版式，不产生正式标签号；正式标签在收料/盈余入库业务中生成。"
      style="margin-bottom: 12px"
    />
    <el-row :gutter="16">
      <el-col :span="10">
        <el-card>
          <template #header>模板配置</template>
          <el-form label-width="90px">
            <el-form-item label="模板类型">
              <el-radio-group v-model="templateType" @change="onTypeChange">
                <el-radio-button value="receiving">收料标签</el-radio-button>
                <el-radio-button value="surplus">盈余入库标签</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="规则 Key">
              <code>{{ TEMPLATE_KEYS[templateType] }}</code>
              <span v-if="currentVersion" style="margin-left: 8px; color: #909399">
                当前 v{{ currentVersion }}
              </span>
            </el-form-item>
            <el-form-item label="打印字段">
              <el-checkbox-group v-model="state.fields">
                <el-checkbox v-for="f in ALL_FIELDS" :key="f.key" :value="f.key">{{ f.label }}</el-checkbox>
              </el-checkbox-group>
            </el-form-item>
            <el-form-item label="条码制式">
              <el-select v-model="state.barcode" style="width: 200px">
                <el-option label="CODE128（一维码）" value="CODE128" />
                <el-option label="QR（二维码）" value="QR" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="save">保存模板</el-button>
              <el-button @click="testPrint">测试打印</el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card style="margin-top: 16px">
          <template #header>补打记录</template>
          <el-alert type="info" :closable="false" show-icon>
            <template #title>
              标签补打通过 <code>POST /api/receiving/labels/reprint</code> 发起；
              后端暂不提供补打记录查询接口，联调后在此展示补打时间 / 操作人 / 原标签号 / 补打原因。
            </template>
          </el-alert>
        </el-card>
      </el-col>

      <el-col :span="14">
        <el-card>
          <template #header>实时预览（示例数据）</template>
          <div class="label-preview">
            <div class="label-title">{{ templateType === 'receiving' ? '收料标签' : '盈余入库标签' }}</div>
            <div class="label-body">
              <div v-for="f in previewFields" :key="f.key" class="label-row">
                <span class="label-key">{{ f.label }}</span>
                <span class="label-val">{{ SAMPLE[f.key] }}</span>
              </div>
              <el-empty v-if="previewFields.length === 0" description="未勾选字段" :image-size="60" />
            </div>
            <div class="label-barcode">
              <div v-if="state.barcode === 'CODE128'" class="barcode-128">
                <span v-for="n in 40" :key="n" :style="{ width: `${(n * 7) % 3 + 1}px` }" />
              </div>
              <div v-else class="barcode-qr">
                <span v-for="n in 49" :key="n" :class="{ on: (n * 13) % 5 < 2 }" />
              </div>
              <div class="barcode-text">{{ state.barcode }} · {{ SAMPLE.packageNo }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="printVisible" title="测试打印预览" width="420px">
      <el-alert
        type="warning"
        show-icon
        :closable="false"
        title="测试打印仅用于校验版式，不产生正式标签号、不写入业务数据。"
        style="margin-bottom: 12px"
      />
      <div class="label-preview" style="margin: 0 auto">
        <div class="label-title">{{ templateType === 'receiving' ? '收料标签（测试）' : '盈余入库标签（测试）' }}</div>
        <div class="label-body">
          <div v-for="f in previewFields" :key="f.key" class="label-row">
            <span class="label-key">{{ f.label }}</span>
            <span class="label-val">{{ SAMPLE[f.key] }}</span>
          </div>
        </div>
        <div class="label-barcode">
          <div class="barcode-text">{{ state.barcode }} · TEST-NO-FORMAL</div>
        </div>
      </div>
      <template #footer>
        <el-button type="primary" @click="printVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.label-preview {
  width: 340px;
  border: 2px solid #303133;
  border-radius: 4px;
  padding: 12px;
  background: #fff;
  font-family: 'Courier New', monospace;
}
.label-title {
  text-align: center;
  font-weight: 700;
  font-size: 16px;
  border-bottom: 1px dashed #909399;
  padding-bottom: 8px;
  margin-bottom: 8px;
}
.label-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  line-height: 1.9;
}
.label-key { color: #606266; }
.label-val { font-weight: 600; }
.label-barcode {
  margin-top: 10px;
  border-top: 1px dashed #909399;
  padding-top: 8px;
  text-align: center;
}
.barcode-128 {
  display: flex;
  justify-content: center;
  gap: 1px;
  height: 44px;
  margin-bottom: 4px;
}
.barcode-128 span { background: #000; height: 100%; display: inline-block; }
.barcode-qr {
  display: grid;
  grid-template-columns: repeat(7, 10px);
  gap: 1px;
  justify-content: center;
  margin-bottom: 4px;
}
.barcode-qr span { width: 10px; height: 10px; background: #fff; }
.barcode-qr span.on { background: #000; }
.barcode-text { font-size: 12px; color: #303133; letter-spacing: 1px; }
</style>
