use serde::Deserialize;
use image::RgbaImage;
#[derive(Clone,Copy,Debug,Deserialize)]
pub struct Rect {pub x:f64,pub y:f64,pub w:f64,pub h:f64}
#[derive(Clone,Copy,Debug)]
pub struct Pixels {pub x:u32,pub y:u32,pub w:u32,pub h:u32}
pub fn validate(rects:&[Rect],w:u32,h:u32)->Result<Vec<Pixels>,String>{
 if w<5||h<5{return Err("素材尺寸太小".into());}
 if rects.is_empty()||rects.len()>16{return Err("请添加 1–16 个修补区域".into());}
 rects.iter().map(|r|{
  if ![r.x,r.y,r.w,r.h].iter().all(|v|v.is_finite())||r.x<0.||r.y<0.||r.w<=0.||r.h<=0.||r.x+r.w>1.00001||r.y+r.h>1.00001{return Err("选框坐标无效".into());}
  let x=((r.x*w as f64).round() as u32).clamp(1,w-3);
  let y=((r.y*h as f64).round() as u32).clamp(1,h-3);
  let rw=((r.w*w as f64).round() as u32).min(w-x-1);
  let rh=((r.h*h as f64).round() as u32).min(h-y-1);
  if rw<2||rh<2{return Err("选框太小，请放大选框".into());}
  Ok(Pixels{x,y,w:rw,h:rh})
 }).collect()
}
pub fn apply(img:&mut RgbaImage,rects:&[Pixels]){
 for r in rects {
  let src=img.clone();let l=r.x;let t=r.y;let right=l+r.w-1;let bottom=t+r.h-1;
  for y in t+1..bottom {for x in l+1..right {
   let dl=(x-l) as f64;let dr=(right-x) as f64;let dt=(y-t) as f64;let db=(bottom-y) as f64;
   let weights=[dr*dt*db,dl*dt*db,dl*dr*db,dl*dr*dt];
   let mut pixel=[0u8;4];
   for c in 0..4{
    let samples=[
     (src.get_pixel(l,y-1)[c] as f64+src.get_pixel(l,y)[c] as f64+src.get_pixel(l,y+1)[c] as f64)/3.,
     (src.get_pixel(right+1,y-1)[c] as f64+src.get_pixel(right+1,y)[c] as f64+src.get_pixel(right+1,y+1)[c] as f64)/3.,
     (src.get_pixel(x-1,t)[c] as f64+src.get_pixel(x,t)[c] as f64+src.get_pixel(x+1,t)[c] as f64)/3.,
     (src.get_pixel(x-1,bottom)[c] as f64+src.get_pixel(x,bottom)[c] as f64+src.get_pixel(x+1,bottom)[c] as f64)/3.];
    pixel[c]=(samples.iter().zip(weights).map(|(s,w)|s*w).sum::<f64>()/weights.iter().sum::<f64>()).round().clamp(0.,255.) as u8;
   }
   img.put_pixel(x,y,image::Rgba(pixel));
  }}
 }
}
#[cfg(test)]
mod tests {
 use super::*;
 #[test] fn rejects_invalid_regions(){assert!(validate(&[Rect{x:f64::NAN,y:0.,w:0.1,h:0.1}],100,100).is_err());assert!(validate(&[],100,100).is_err());}
 #[test] fn repairs_flat_background_and_preserves_outside(){
  let mut img=RgbaImage::from_pixel(20,20,image::Rgba([24,48,72,255]));
  for y in 7..12{for x in 7..12{img.put_pixel(x,y,image::Rgba([255,255,255,255]));}}
  apply(&mut img,&[Pixels{x:5,y:5,w:10,h:10}]);
  assert!(img.pixels().all(|p|p.0==[24,48,72,255]));
 }
 #[test] fn edge_regions_keep_sampling_inside(){let r=validate(&[Rect{x:0.,y:0.,w:1.,h:1.}],20,20).unwrap();let mut img=RgbaImage::new(20,20);apply(&mut img,&r);}
}
