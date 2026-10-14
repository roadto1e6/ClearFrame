#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod repair;
use std::{path::{Path, PathBuf}, process::{Command, Stdio}, sync::Mutex, io::{BufRead, BufReader}};
use tauri::{Emitter, Manager};
use serde::{Serialize, Deserialize};
use image::GenericImageView;
use repair::Rect;

struct Media { source: PathBuf, preview: PathBuf, width: u32, height: u32, duration: f64, video: bool, _temp: tempfile::TempDir }
#[derive(Default)]
struct State { media: Mutex<Option<Media>>, busy: Mutex<bool> }
#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
struct Info { name: String, preview: String, width: u32, height: u32, duration: f64, video: bool }
#[derive(Clone, Serialize)]
struct Progress { percent: f64, message: String }
#[derive(Deserialize)]
struct ExportRequest { rects: Vec<Rect> }

fn ffmpeg(app: &tauri::AppHandle) -> Result<PathBuf,String> {
 let mut candidates=vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tools/ffmpeg.exe")];
 if let Ok(p)=app.path().resource_dir(){ candidates.push(p.join("tools/ffmpeg.exe")); }
 if let Ok(p)=std::env::current_exe(){ candidates.push(p.parent().unwrap().join("tools/ffmpeg.exe")); }
 candidates.into_iter().find(|p|p.is_file()).ok_or("缺少 FFmpeg，请运行安装依赖脚本。".into())
}
fn cmd(path:&Path)->Command {
 let mut c=Command::new(path);
 #[cfg(windows)] { use std::os::windows::process::CommandExt; c.creation_flags(0x08000000); }
 c
}
fn run(c:&mut Command)->Result<(),String>{
 let out=c.output().map_err(|e|e.to_string())?;
 if out.status.success(){Ok(())}else{Err(String::from_utf8_lossy(&out.stderr).chars().rev().take(1600).collect::<String>().chars().rev().collect())}
}
fn progress(app:&tauri::AppHandle,p:f64,msg:&str){let _=app.emit("export-progress",Progress{percent:p,message:msg.into()});}
fn load(app:&tauri::AppHandle,path:PathBuf)->Result<Info,String>{
 let ext=path.extension().and_then(|s|s.to_str()).unwrap_or("").to_lowercase();
 let video=!["png","jpg","jpeg","webp","bmp","tif","tiff"].contains(&ext.as_str());
 let temp=tempfile::tempdir().map_err(|e|e.to_string())?;
 let (preview,w,h,duration)=if video {
  let ff=ffmpeg(app)?;
  let probe=cmd(&ff).args(["-hide_banner","-i"]).arg(&path).output().map_err(|e|e.to_string())?;
  let text=String::from_utf8_lossy(&probe.stderr);
  let re=regex::Regex::new(r"Duration: (\d+):(\d+):([\d.]+)").unwrap();
  let duration=re.captures(&text).map(|c|c[1].parse::<f64>().unwrap_or(0.)*3600.+c[2].parse::<f64>().unwrap_or(0.)*60.+c[3].parse::<f64>().unwrap_or(0.)).unwrap_or(0.);
  let frame=temp.path().join("frame.png");
  run(cmd(&ff).args(["-hide_banner","-loglevel","error","-nostdin","-y","-i"]).arg(&path).args(["-map","0:v:0","-frames:v","1","-update","1"]).arg(&frame))?;
  let (w,h)=image::image_dimensions(&frame).map_err(|e|e.to_string())?;
  let preview=temp.path().join("preview.mp4");
  run(cmd(&ff).args(["-hide_banner","-loglevel","error","-nostdin","-y","-i"]).arg(&path).args(["-map","0:v:0","-map","0:a:0?","-vf","scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2","-c:v","libx264","-preset","ultrafast","-crf","25","-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart"]).arg(&preview))?;
  (preview,w,h,duration)
 }else{
  let mut img=image::ImageReader::open(&path).map_err(|e|e.to_string())?.decode().map_err(|e|e.to_string())?;
  // Apply EXIF orientation so displayed coordinates agree with exported pixels.
  if let Ok(reader)=image::ImageReader::open(&path) {if let Ok(mut decoder)=reader.into_decoder(){use image::ImageDecoder;if let Ok(o)=decoder.orientation(){img.apply_orientation(o);}}}
  let (w,h)=img.dimensions();
  let preview=temp.path().join("image.png");img.save(&preview).map_err(|e|e.to_string())?;
  (preview,w,h,0.)
 };
 app.asset_protocol_scope().allow_file(&preview).map_err(|e|e.to_string())?;
 let info=Info{name:path.file_name().unwrap_or_default().to_string_lossy().into(),preview:preview.to_string_lossy().into(),width:w,height:h,duration,video};
 let state=app.state::<State>();
 let mut lock=state.media.lock().map_err(|e|e.to_string())?;
 if let Some(old)=lock.as_ref(){let _=app.asset_protocol_scope().forbid_file(&old.preview);}
 *lock=Some(Media{source:path,preview,width:w,height:h,duration,video,_temp:temp});
 Ok(info)
}
fn acquire(app:&tauri::AppHandle)->Result<(),String>{let state=app.state::<State>();let mut b=state.busy.lock().map_err(|e|e.to_string())?;if *b{return Err("正在处理，请稍候。".into());}*b=true;Ok(())}
fn release(app:&tauri::AppHandle){if let Ok(mut b)=app.state::<State>().busy.lock(){*b=false;}}
#[tauri::command]
async fn open_media(app:tauri::AppHandle)->Result<Option<Info>,String>{
 acquire(&app)?;
 let a=app.clone();
 let result=tauri::async_runtime::spawn_blocking(move||{
  let file=rfd::FileDialog::new().add_filter("图片 / 视频",&["png","jpg","jpeg","webp","bmp","tif","tiff","mp4","mov","mkv","webm","avi","m4v"]).pick_file();
  file.map(|p|load(&a,p)).transpose()
 }).await.map_err(|e|e.to_string()).and_then(|r|r);
 release(&app);result
}
#[tauri::command]
async fn export_media(app:tauri::AppHandle,request:ExportRequest)->Result<Option<String>,String>{
 acquire(&app)?;
 let a=app.clone();
 let result=tauri::async_runtime::spawn_blocking(move||export(&a,request)).await.map_err(|e|e.to_string()).and_then(|r|r);
 release(&app);result
}
fn export(app:&tauri::AppHandle,request:ExportRequest)->Result<Option<String>,String>{
 let state=app.state::<State>();let lock=state.media.lock().map_err(|e|e.to_string())?;
 let media=lock.as_ref().ok_or("请先导入文件")?;
 let rects=repair::validate(&request.rects,media.width,media.height)?;
 let ext=if media.video{"mp4"}else{"png"};
 let name=format!("{}-修补.{}",media.source.file_stem().unwrap_or_default().to_string_lossy(),ext);
 let Some(mut output)=rfd::FileDialog::new().set_file_name(&name).add_filter(ext,&[ext]).save_file()else{return Ok(None)};
 if output.extension().and_then(|s|s.to_str()).unwrap_or("").to_lowercase()!=ext{output.set_extension(ext);}
 if output==media.source || (output.exists()&&output.canonicalize().ok()==media.source.canonicalize().ok()){return Err("请选择新文件名，不能覆盖原素材。".into());}
 let parent=output.parent().ok_or("保存目录无效")?;
 let mut temp=tempfile::Builder::new().prefix(".clearframe-").suffix(&format!(".{ext}")).tempfile_in(parent).map_err(|e|e.to_string())?;
 progress(app,1.,"正在修补");
 if media.video {
  let filter=rects.iter().map(|r|format!("delogo=x={}:y={}:w={}:h={}",r.x,r.y,r.w,r.h)).collect::<Vec<_>>().join(",");
  let filter=format!("{filter},pad=ceil(iw/2)*2:ceil(ih/2)*2");
  let ff=ffmpeg(app)?;
  let log=tempfile::tempfile().map_err(|e|e.to_string())?;
  let mut child=cmd(&ff).args(["-hide_banner","-loglevel","error","-nostdin","-y","-i"]).arg(&media.source)
   .args(["-map","0:v:0","-map","0:a?","-vf",&filter,"-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p","-c:a","aac","-b:a","192k","-movflags","+faststart","-progress","pipe:1","-nostats"])
   .arg(temp.path()).stdout(Stdio::piped()).stderr(Stdio::from(log.try_clone().map_err(|e|e.to_string())?)).spawn().map_err(|e|e.to_string())?;
  for line in BufReader::new(child.stdout.take().unwrap()).lines().map_while(Result::ok){
   if let Some(t)=line.strip_prefix("out_time_us=").and_then(|s|s.parse::<f64>().ok()){progress(app,if media.duration>0.{(t/1e6/media.duration*99.).clamp(1.,99.)}else{20.},"正在编码视频");}
  }
  if !child.wait().map_err(|e|e.to_string())?.success(){use std::io::{Read,Seek,SeekFrom};let mut log=log;let _=log.seek(SeekFrom::Start(0));let mut msg=String::new();let _=log.read_to_string(&mut msg);return Err(format!("视频导出失败：{msg}"));}
 }else{
  let mut img=image::open(&media.preview).map_err(|e|e.to_string())?.to_rgba8();
  repair::apply(&mut img,&rects);
  img.write_to(temp.as_file_mut(),image::ImageFormat::Png).map_err(|e|e.to_string())?;
 }
 temp.persist(&output).map_err(|e|e.to_string())?;
 progress(app,100.,"导出完成");
 Ok(Some(output.to_string_lossy().into()))
}
fn main(){
 tauri::Builder::default().manage(State::default()).invoke_handler(tauri::generate_handler![open_media,export_media])
 .run(tauri::generate_context!()).expect("应用启动失败");
}
