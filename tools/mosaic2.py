import cv2, sys, numpy as np
rois=np.load(sys.argv[1]); T,H,W,_=rois.shape
def prep(r):
    g=cv2.cvtColor(r,cv2.COLOR_BGR2GRAY).astype(np.float32)
    return cv2.Sobel(g,cv2.CV_32F,1,0,ksize=3)
sharp=np.array([cv2.Laplacian(cv2.cvtColor(r,cv2.COLOR_BGR2GRAY),cv2.CV_64F).var() for r in rois])
win=cv2.createHanningWindow((W,H),cv2.CV_32F)
P=[prep(r) for r in rois]
pos=np.zeros(T); dy=np.zeros(T)
for t in range(1,T):
    (a,b),_=cv2.phaseCorrelate(P[t-1],P[t],win); pos[t]=pos[t-1]+a; dy[t]=dy[t-1]+b
dy-=np.median(dy)
print("dy range",dy.min(),dy.max(),"sharp min/med",sharp.min(),np.median(sharp))
minu=int(np.floor(-pos.max())); CW=int(np.ceil(W-pos.min()))-minu
best=np.full(CW,-1e9); out=np.zeros((H,CW,3),np.uint8)
c=np.arange(W)
for t in range(T):
    M=np.float32([[1,0,-pos[t]-minu],[0,1,-dy[t]]])
    warped=cv2.warpAffine(rois[t],M,(CW,H),flags=cv2.INTER_LINEAR)
    # score per canvas column: closeness to frame center + sharpness
    u=(c-pos[t]-minu)
    score_frame=-np.abs(c-W/2)/(W/2) + 0.5*np.log(sharp[t]/np.median(sharp))
    for ci in range(8,W-8):
        ui=int(round(u[ci]))
        if 0<=ui<CW and score_frame[ci]>best[ui]:
            best[ui]=score_frame[ci]; out[:,ui]=warped[:,ui]
cv2.imwrite(sys.argv[2],out); print(out.shape)
