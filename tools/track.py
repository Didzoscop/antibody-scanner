import cv2, sys, numpy as np
X0,X1,Y0,Y1 = 1840,1958,600,1230
cap = cv2.VideoCapture(sys.argv[1])
rois=[]
while True:
    ok,f=cap.read()
    if not ok: break
    rois.append(f[Y0:Y1,X0:X1].copy())
np.save(sys.argv[2], np.array(rois))
def prep(r):
    g=cv2.cvtColor(r,cv2.COLOR_BGR2GRAY).astype(np.float32)
    g=cv2.Sobel(g,cv2.CV_32F,1,0,ksize=3)
    return g
win=cv2.createHanningWindow((X1-X0,Y1-Y0),cv2.CV_32F)
dxs=[];resp=[]
prev=prep(rois[0])
for r in rois[1:]:
    cur=prep(r)
    (dx,dy),rsp=cv2.phaseCorrelate(prev,cur,win)
    dxs.append(dx);resp.append(rsp);prev=cur
dxs=np.array(dxs); pos=np.concatenate([[0],np.cumsum(dxs)])
print(len(rois))
print("dx:",np.round(dxs,1).tolist())
print("resp min/med:",np.min(resp),np.median(resp))
print("pos range",pos.min(),pos.max())
np.save(sys.argv[3],pos)
