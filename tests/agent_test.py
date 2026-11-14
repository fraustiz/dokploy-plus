import unittest,sys,time,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'agent'))
import cleanup
class CleanupTest(unittest.TestCase):
 def test_protects_named_and_used_images_and_rechecks_preview(self):
  with tempfile.TemporaryDirectory() as tmp:
   cleanup.KEY_FILE=Path(tmp)/'key';cleanup.KEY_FILE.write_text('test-only-key')
   rows=[{'Id':'old','Containers':0,'Created':time.time()-8*86400,'RepoTags':[]},{'Id':'named','Containers':0,'Created':0,'RepoTags':['app:rollback']},{'Id':'used','Containers':1,'Created':0,'RepoTags':[]}];deleted=[]
   def docker(path,method='GET'):
    if method=='DELETE':deleted.append(path);return []
    return {'Images':rows}
   cleanup.insights.docker=docker
   preview=cleanup.preview();self.assertEqual([i['id'] for i in preview['images']],['old'])
   with self.assertRaises(ValueError):cleanup.apply({'ticket':preview['ticket'],'ids':['named'],'confirmation':'DELETE'})
   rows[0]['Containers']=1;result=cleanup.apply({'ticket':preview['ticket'],'ids':['old'],'confirmation':'DELETE'});self.assertFalse(result['results'][0]['deleted']);self.assertEqual(deleted,[])
if __name__=='__main__':unittest.main()
