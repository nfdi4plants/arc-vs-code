<script setup>
import {ref,reactive,onMounted} from 'vue';
import {ARC, ArcStudy, ArcAssay} from "@nfdi4plants/arctrl";
import {Xlsx} from '@fslab/fsspreadsheet/Xlsx.js';
import {JsonController} from "@nfdi4plants/arctrl";

const iProps = reactive({
  arc: null,
  loading: false,
  show_timeout: false,
  current_identifier: null,
  resources_path: ''
});

let iframe = ref({});

const VSCODE_API = {
  swate_init_acid: null,

  init: async inMessage => {
    if(VSCODE_API.swate_init_acid)
      return VSCODE_API.send({acid:inMessage.acid, api:'swate_ready'});

    console.log('[VUE] INIT SWATE');
    VSCODE_API.swate_init_acid = inMessage.acid;
    iProps.loading = true;
    iProps.show_timeout = false;
    setTimeout(()=>iProps.show_timeout=true,4000);

    iframe.value.setAttribute("src", `https://swate-alpha.nfdi4plants.org?is_swatehost=1&random=${parseInt(Math.random()*1000)}`);
  },

  send: outMessage=>{
    return new Promise((resolve)=>{
      outMessage.acid = outMessage.acid || 1+Math.random();
      const listener = event=>{
        const inMessage = event.data;
        if(inMessage.acid !== outMessage.acid) return;
        window.removeEventListener("message", listener);
        resolve(inMessage);
      };
      window.addEventListener("message", listener);
      window.vscode.postMessage(outMessage);
    });
  },

  sendNoWait: outMessage=>{
    outMessage.acid = outMessage.acid || 1+Math.random();
    window.vscode.postMessage(outMessage);
  },

  read_ARC: async inMessage=>{
    const arc = ARC.fromFilePaths(inMessage.xlsx_paths);
    const contracts = arc.GetReadContracts();
    for(const contract of contracts){
      const response = await VSCODE_API.send({api:'read',path:contract.Path});
      contract.DTO = await Xlsx.fromBytes(response.data);
    }
    arc.SetISAFromContracts(contracts);
    iProps.arc = arc;
    console.log('[VUE] ARC',[arc,inMessage,contracts]);
    window.vscode.postMessage({acid:inMessage.acid});
  },

  write_ARC: async force=>{
    console.log('[VUE] WRITING ARC');
    const arc = iProps.arc;
    arc.UpdateFileSystem();
    let contracts = force ? arc.GetWriteContracts() : arc.GetUpdateContracts();
    await VSCODE_API.handle_contracts(contracts);
  },

  handle_contracts: async contracts => {
    for(const contract of contracts) {
      console.log('[VUE] CONTRACT',contract);
      switch (contract.Operation) {
        case 'DELETE':
          await VSCODE_API.send({api:'delete', path: contract.Path});
          break;
        case 'UPDATE': case 'CREATE':
          if(['ISA_Investigation','ISA_Study','ISA_Assay', 'ISA_Datamap'].includes(contract.DTOType)){
            const buffer = await Xlsx.toBytes(contract.DTO);
            await VSCODE_API.send({api:'write', path: contract.Path, data: buffer});
            break;
          } else if(contract.DTOType==='PlainText'){
            const buffer = new TextEncoder().encode(contract.DTO || '');
            await VSCODE_API.send({api:'write', path: contract.Path, data: buffer});
          } else {
            return console.error('[VUE] unable to resolve write contract', contract);
          }
          break;
        case 'RENAME':
          console.error('[VUE] TODO RENAME')
          break;
        default:
          console.log(`[VUE] Warning. 'handleARCContracts' hit unknown expression for contract type: ${contract.Operation} in ${contract}.`)
          break;
      }
    }
  },

  edit_study: async inMessage=>{
    console.log('[VUE] edit_study',inMessage.identifier);
    iProps.current_identifier = inMessage.identifier;
    const i = iProps.arc.ISA.TryGetStudy(inMessage.identifier);
    SWATE_API.send(
      'StudyToSwate',
      { ArcStudyJsonString: JsonController.Study.toJsonString(i,0) }
    );
  },
  add_study: async inMessage=>{
    console.log('[VUE] add_study', inMessage.identifier);
    const new_study = new ArcStudy(inMessage.identifier);
    iProps.arc.ISA.AddStudy(new_study);
    VSCODE_API.write_ARC();
  },
  delete_study: async inMessage=>{
    console.log('[VUE] delete_study', inMessage.identifier);
    if(iProps.current_identifier===inMessage.identifier)
      iProps.current_identifier = 0;
    const contracts = iProps.arc.RemoveStudy(inMessage.identifier)
    VSCODE_API.handle_contracts(contracts);
  },

  edit_assay: async inMessage=>{
    console.log('[VUE] edit_assay',inMessage.identifier);
    iProps.current_identifier = inMessage.identifier;
    const i = iProps.arc.ISA.TryGetAssay(inMessage.identifier);
    SWATE_API.send(
      'AssayToSwate',
      { ArcAssayJsonString: JsonController.Assay.toJsonString(i,0) }
    );
  },
  add_assay: async inMessage=>{
    console.log('[VUE] add_assay', inMessage.identifier);
    const new_assay = new ArcAssay(inMessage.identifier);
    iProps.arc.ISA.AddAssay(new_assay);
    VSCODE_API.write_ARC();
  },
  delete_assay: async inMessage=>{
    console.log('[VUE] delete_assay', inMessage.identifier);
    if(iProps.current_identifier===inMessage.identifier)
      iProps.current_identifier = 0;
    const contracts = iProps.arc.RemoveAssay(inMessage.identifier)
    VSCODE_API.handle_contracts(contracts);
  },

  edit_investigation: async ()=>{
    console.log('[VUE] edit_investigation');
    iProps.current_identifier = 1;
    SWATE_API.send(
      'InvestigationToSwate',
      { ArcInvestigationJsonString: JsonController.Investigation.toJsonString(iProps.arc.ISA,0) }
    );
  },

};

const SWATE_API = {
  send: (api,data) => {
    const content = { swate: true, api: api, data: data };
    iframe.value.contentWindow.postMessage(content, '*');
  },
  Init: ()=>{
    console.log('[VUE] SWATE ONLINE');
    iProps.loading = false;
    VSCODE_API.sendNoWait({acid:VSCODE_API.swate_init_acid});
  },
  InvestigationToARCitect: jsonString => {
    let i = JsonController.Investigation.fromJsonString(jsonString);
    iProps.arc.ISA = i;
    VSCODE_API.write_ARC();
  },
  AssayToARCitect: jsonString => {
    let i = JsonController.Assay.fromJsonString(jsonString);
    iProps.arc.ISA.SetAssay(i.Identifier, i);
    VSCODE_API.write_ARC();
  },
  StudyToARCitect: jsonString => {
    let i = JsonController.Study.fromJsonString(jsonString);
    iProps.arc.ISA.SetStudy(i.Identifier, i);
    VSCODE_API.write_ARC();
  },
  Error: e => {
    console.log('[VUE] [Swate-Interop-Error]', e)
  }
};

const vscodeCommunicator = event => {
  const inMessage = event.data;
  if(!inMessage.acid || !inMessage.api) return;
  VSCODE_API[inMessage.api](inMessage);
};

const swateCommunicator = event => {
  const inMessage = event.data;
  if(!inMessage.swate) return;
  SWATE_API[inMessage.api](inMessage.data);
};

const init = ()=>{
  VSCODE_API.swate_init_acid = null;
  iProps.loading = false;
  iProps.resources_path = window.resources_path;

  window.addEventListener("message", vscodeCommunicator);
  window.addEventListener("message", swateCommunicator);
};

onMounted(init);

</script>

<template>
  <q-layout view="hHh LpR fFf">
    <q-page-container class='full'>
      <iframe
        class='fit'
        style="border: 0; overflow: hidden; margin-bottom: -1em"
        ref="iframe"
        allow='clipboard-read;clipboard-write;'
        v-show='!iProps.loading && iProps.current_identifier'
      >
      </iframe>

      <div v-show='iProps.loading' style='position:absolute;top:0;left:0;right:0;bottom:0;z-index:9999;'>
        <q-linear-progress size="45px" indeterminate color="primary" class='justify-start'/>
        <div class="q-pa-md q-gutter-sm" v-if='iProps.show_timeout'>
          <q-banner class="bg-grey-9 text-white" rounded inline-actions>
            SWATE Service might be down
          </q-banner>
        </div>
      </div>

      <div v-show='iProps.current_identifier' @click='()=>iProps.current_identifier=0' style="position:absolute;top:10px;right:10px;font-weight:bold;font-size:16px;z-index:9000;cursor:pointer;">x</div>

      <div style="text-align:center;" v-show='!iProps.current_identifier'>
        <img :src="`${iProps.resources_path}/nfdi-hero.svg`" style="box-sizing:border-box;width:100%;padding:4em;max-width:600px;"/>
        <div class='text-h4'><span style="border-bottom:0.1em solid #000;">Welcome to the <b>ARC-VS-CODE</b> Extension!</span></div>
        <div class='text-h6' style="line-height:1em;padding-top:0.5em;">You can add, edit, and delete investigations, studies, and assays through the context menu of the explorer.</div>
      </div>
    </q-page-container>
  </q-layout>
</template>

<style>
.full{
  position:absolute;
  top:0;
  left:0;
  bottom:0;
  right:0;
}
</style>
