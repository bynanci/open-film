import {
  PHOTO_BEZIER_BISECTION_STEPS,
  validatePhotoEasing,
  type PhotoEasing,
} from "@openfilm/core";

/** progressExpression is owned by this adapter, never accepted from project data. */
export function photoEasingExpression(
  easing: PhotoEasing,
  progressExpression: string,
): string {
  const value = validatePhotoEasing(easing);
  const p = progressExpression;
  if (value === "linear") return p;
  if (value === "ease-in-out") return `((${p})*(${p})*(3-2*(${p})))`;
  const polynomial = (a: number, b: number) =>
    `(3*(1-ld(4))*(1-ld(4))*ld(4)*${a}+3*(1-ld(4))*ld(4)*ld(4)*${b}+ld(4)*ld(4)*ld(4))`;
  return `st(0,${p});st(1,0);st(2,1);st(3,0);while(lt(ld(3),${PHOTO_BEZIER_BISECTION_STEPS}),st(4,(ld(1)+ld(2))/2);if(lt(${polynomial(value.x1, value.x2)},ld(0)),st(1,ld(4)),st(2,ld(4)));st(3,ld(3)+1));st(4,(ld(1)+ld(2))/2);if(lte(ld(0),0),0,if(gte(ld(0),1),1,${polynomial(value.y1, value.y2)}))`;
}
